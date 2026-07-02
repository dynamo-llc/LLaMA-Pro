const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn, fork, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const serve = require('electron-serve');
const net = require('net');
const { autoUpdater } = require('electron-updater');

const loadURL = serve({ directory: path.join(__dirname, 'ui-dist') });

let mainWindow = null;
let serverProcess = null;
let orchestratorProcess = null;
let latticaProcess = null;
let echoProcess = null;
let rpcServerProcess = null;

function getFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(getFreePort(startPort + 1)));
  });
}

function streamLogs(proc, name) {
  const sendLog = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend-log', { source: name, data: data.toString() });
    }
  };
  proc.stdout.on('data', (data) => {
    console.log(`[${name}] ${data}`);
    sendLog(data);
  });
  proc.stderr.on('data', (data) => {
    console.error(`[${name}] ${data}`);
    sendLog(data);
  });
}

async function startBackendProcesses() {
  const isPackaged = app.isPackaged;
  
  let serverPath;
  let orchestratorPath;
  let orchestratorArgs = [];
  let serverCwd;
  let orchestratorCwd;
  let latticaPath;
  let latticaArgs = [];
  let latticaCwd;
  let echoPath;
  let echoArgs = [];
  let echoCwd;

  if (isPackaged) {
    const installedBinDir = path.join(process.resourcesPath, 'bin');
    const installedServer = path.join(installedBinDir, 'llama-server.exe');
    const installedOrchestrator = path.join(process.resourcesPath, 'orchestrator.exe');

    if (fs.existsSync(installedServer)) {
      serverPath = installedServer;
      orchestratorPath = installedOrchestrator;
      serverCwd = installedBinDir;
      orchestratorCwd = process.resourcesPath;
      latticaCwd = path.join(process.resourcesPath, 'lattica');
      latticaPath = 'fork';
      latticaArgs = ['dist/daemon.js'];
      echoCwd = path.join(process.resourcesPath, 'echo');
      echoPath = 'fork';
      echoArgs = ['index.js'];
    } else {
      // Dev/unpacked fallback (e.g. running from dist/win-unpacked directly)
      const devBinDir = path.resolve(path.join(process.resourcesPath, '../../../../build/bin'));
      const devOrchestratorDir = path.resolve(path.join(process.resourcesPath, '../../../../tools/orchestrator'));
      
      serverPath = path.join(devBinDir, 'llama-server.exe');
      serverCwd = devBinDir;
      
      const compiledOrchestrator = path.join(devOrchestratorDir, 'dist/orchestrator.exe');
      const devPython = path.resolve(path.join(process.resourcesPath, '../../../../.venv/Scripts/python.exe'));
      
      if (fs.existsSync(compiledOrchestrator)) {
        orchestratorPath = compiledOrchestrator;
        orchestratorCwd = path.join(devOrchestratorDir, 'dist');
      } else {
        orchestratorPath = devPython;
        orchestratorArgs = [path.join(devOrchestratorDir, 'main.py')];
        orchestratorCwd = devOrchestratorDir;
      }
      
      latticaCwd = path.resolve(path.join(process.resourcesPath, '../../../../tools/lattica'));
      latticaPath = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      latticaArgs = ['ts-node', 'daemon.ts'];
      
      echoCwd = path.resolve(path.join(process.resourcesPath, '../../../../tools/echo'));
      echoPath = process.platform === 'win32' ? 'node.exe' : 'node';
      echoArgs = ['index.js'];
    }
  } else {
    // Development mode
    const devBinDir = path.resolve(path.join(__dirname, '../../build/bin'));
    const devOrchestratorDir = path.resolve(path.join(__dirname, '../orchestrator'));
    const devPython = path.resolve(path.join(__dirname, '../../.venv/Scripts/python.exe'));

    serverPath = path.join(devBinDir, 'llama-server.exe');
    serverCwd = devBinDir;
    
    orchestratorPath = devPython;
    orchestratorArgs = [path.join(devOrchestratorDir, 'main.py')];
    orchestratorCwd = devOrchestratorDir;
    
    latticaCwd = path.resolve(path.join(__dirname, '../lattica'));
    latticaPath = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    latticaArgs = ['ts-node', 'daemon.ts'];

    echoCwd = path.resolve(path.join(__dirname, '../echo'));
    echoPath = process.platform === 'win32' ? 'node.exe' : 'node';
    echoArgs = ['index.js'];
  }

  console.log(`Starting Lattica Daemon from: ${latticaCwd}`);
  if (latticaPath === 'fork') {
    latticaProcess = fork(path.join(latticaCwd, latticaArgs[0]), [], { cwd: latticaCwd, stdio: 'ignore' });
  } else {
    latticaProcess = spawn(latticaPath, latticaArgs, { cwd: latticaCwd, stdio: 'ignore' });
  }
  
  latticaProcess.on('error', (err) => {
    console.error('Failed to start Lattica daemon:', err);
  });

  console.log(`Starting Echo Server from: ${echoCwd}`);
  if (echoPath === 'fork') {
    echoProcess = fork(path.join(echoCwd, echoArgs[0]), [], { cwd: echoCwd, stdio: 'ignore' });
  } else {
    echoProcess = spawn(echoPath, echoArgs, { cwd: echoCwd, stdio: 'ignore' });
  }
  
  echoProcess.on('error', (err) => {
    console.error('Failed to start Echo server:', err);
  });

  let globalServerPath = serverPath;
  let globalServerCwd = serverCwd;

  global.llamaPort = await getFreePort(8080);
  global.orchestratorPort = await getFreePort(8000);

  // We attach this to global so the IPC handler can use it later
  global.startLlamaServer = async function(useMesh = false) {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
      console.log('Killed existing llama-server process for restart');
      await new Promise(resolve => setTimeout(resolve, 500)); // give it a moment
    }

    let rpcArgs = [];
    if (useMesh) {
      try {
        console.log('Querying Lattica daemon for peers...');
        const res = await fetch('http://127.0.0.1:50053/peers');
        const data = await res.json();
        if (data && data.peers && data.peers.length > 0) {
          const endpoints = data.peers.map(p => p.endpoint);
          console.log(`Discovered ${data.peers.length} RPC peers: ${endpoints.join(',')}`);
          rpcArgs = ['--rpc', endpoints.join(',')];
        } else {
          console.log('No Lattica RPC peers discovered.');
        }
      } catch (err) {
        console.error('Failed to query Lattica peers:', err.message);
      }
    }

    const serverArgs = ['--port', global.llamaPort.toString(), '--host', '127.0.0.1', ...rpcArgs];
    console.log(`Starting C++ backend from: ${globalServerPath} with args:`, serverArgs);
    serverProcess = spawn(globalServerPath, serverArgs, {
      cwd: globalServerCwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    streamLogs(serverProcess, 'llama-server');

    serverProcess.on('error', (err) => {
      console.error('Failed to start llama-server process:', err);
    });
    return true;
  };

  await global.startLlamaServer(false); // Default to local only at startup
  
  console.log(`Starting Python orchestrator from: ${orchestratorPath}`);
  
  // Try to pass port if orchestrator supports it, or use environment variables if we wanted, but since it's hardcoded to 8000 in python, we would need to pass it
  orchestratorArgs.push('--port', global.orchestratorPort.toString());
  orchestratorProcess = spawn(orchestratorPath, orchestratorArgs, {
    cwd: orchestratorCwd,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  streamLogs(orchestratorProcess, 'orchestrator');

  orchestratorProcess.on('error', (err) => {
    console.error('Failed to start orchestrator process:', err);
  });
}

function stopBackendProcesses() {
  console.log('Stopping backend processes...');
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (latticaProcess) {
    latticaProcess.kill();
    latticaProcess = null;
  }
  if (echoProcess) {
    echoProcess.kill();
    echoProcess = null;
  }
  if (rpcServerProcess) {
    rpcServerProcess.kill();
    rpcServerProcess = null;
  }
  if (orchestratorProcess) {
    // Attempt graceful shutdown first
    fetch('http://127.0.0.1:8000/api/shutdown', { method: 'POST' })
      .catch((err) => console.log('Orchestrator shutdown request failed:', err));
    
    // Forcefully kill the entire process tree synchronously to avoid orphans
    try {
      if (process.platform === 'win32') {
        require('child_process').execSync(`taskkill /pid ${orchestratorProcess.pid} /t /f`);
      } else {
        process.kill(-orchestratorProcess.pid); // kill process group
      }
    } catch (e) {
      console.log('Failed to kill orchestrator tree:', e);
    }
    orchestratorProcess = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'LLaMA Pro',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenuBarVisibility(false);

  loadURL(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers for RPC Server
ipcMain.handle('start-rpc-server', () => {
  if (rpcServerProcess) return { success: true, message: 'Already running' };
  
  const devBinDir = path.resolve(path.join(__dirname, '../../build/bin'));
  const rpcServerPath = path.join(devBinDir, 'rpc-server.exe');
  
  console.log(`Starting rpc-server from: ${rpcServerPath}`);
  rpcServerProcess = spawn(rpcServerPath, ['-p', '50052'], {
    cwd: devBinDir,
    stdio: 'ignore'
  });
  
  rpcServerProcess.on('error', (err) => {
    console.error('Failed to start rpc-server process:', err);
  });
  
  return { success: true };
});

ipcMain.handle('stop-rpc-server', () => {
  if (rpcServerProcess) {
    rpcServerProcess.kill();
    rpcServerProcess = null;
  }
  return { success: true };
});

ipcMain.handle('restart-backend', async (_event, options) => {
  const useMesh = options && options.useMesh;
  return await global.startLlamaServer(useMesh);
});

ipcMain.handle('get-ports', () => {
  return { llamaPort: global.llamaPort, orchestratorPort: global.orchestratorPort };
});

ipcMain.handle('export-logs', async (event, logText) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Logs',
    defaultPath: 'llama-pro-logs.txt',
    filters: [{ name: 'Text Files', extensions: ['txt'] }]
  });
  if (!canceled && filePath) {
    const fs = require('fs');
    fs.writeFileSync(filePath, logText);
    return true;
  }
  return false;
});

ipcMain.handle('quit-and-install', () => {
  autoUpdater.quitAndInstall();
});

autoUpdater.on('update-downloaded', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-ready');
  }
});

autoUpdater.on('error', (error) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-error', error == null ? "unknown" : (error.stack || error).toString());
  }
});

app.whenReady().then(() => {
  autoUpdater.checkForUpdatesAndNotify();
  startBackendProcesses().then(() => {
    createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (!serverProcess || !orchestratorProcess) {
        startBackendProcesses().then(() => createWindow());
      } else {
        createWindow();
      }
    }
  });
});

app.on('window-all-closed', () => {
  stopBackendProcesses();
  if (process.platform !== 'darwin') {
    // Wait for the graceful shutdown before quitting
    setTimeout(() => {
      app.quit();
    }, 1500);
  }
});
