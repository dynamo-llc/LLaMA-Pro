const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const serve = require('electron-serve');

const loadURL = serve({ directory: path.join(__dirname, 'ui-dist') });

let mainWindow = null;
let serverProcess = null;
let orchestratorProcess = null;
let latticaProcess = null;
let echoProcess = null;
let rpcServerProcess = null;

async function startBackendProcesses() {
  const fs = require('fs');
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
    const installedBinDir = path.resolve(path.join(process.resourcesPath, '../bin'));
    const installedServer = path.join(installedBinDir, 'llama-server.exe');
    const installedOrchestrator = path.join(installedBinDir, 'orchestrator.exe');

    if (fs.existsSync(installedServer)) {
      serverPath = installedServer;
      orchestratorPath = installedOrchestrator;
      serverCwd = installedBinDir;
      orchestratorCwd = installedBinDir;
      latticaCwd = path.join(process.resourcesPath, '../tools/lattica');
      latticaPath = 'npx.cmd';
      latticaArgs = ['ts-node', 'daemon.ts'];
      echoCwd = path.join(process.resourcesPath, '../tools/echo');
      echoPath = 'node';
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
  latticaProcess = spawn(latticaPath, latticaArgs, {
    cwd: latticaCwd,
    stdio: 'ignore'
  });
  
  latticaProcess.on('error', (err) => {
    console.error('Failed to start Lattica daemon:', err);
  });

  console.log(`Starting Echo Server from: ${echoCwd}`);
  echoProcess = spawn(echoPath, echoArgs, {
    cwd: echoCwd,
    stdio: 'ignore'
  });
  
  echoProcess.on('error', (err) => {
    console.error('Failed to start Echo server:', err);
  });

  let globalServerPath = serverPath;
  let globalServerCwd = serverCwd;

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

    const serverArgs = ['--port', '8080', '--host', '127.0.0.1', ...rpcArgs];
    console.log(`Starting C++ backend from: ${globalServerPath} with args:`, serverArgs);
    serverProcess = spawn(globalServerPath, serverArgs, {
      cwd: globalServerCwd,
      stdio: 'ignore'
    });
    
    serverProcess.on('error', (err) => {
      console.error('Failed to start llama-server process:', err);
    });
    return true;
  };

  await global.startLlamaServer(false); // Default to local only at startup
  
  console.log(`Starting Python orchestrator from: ${orchestratorPath}`);
  orchestratorProcess = spawn(orchestratorPath, orchestratorArgs, {
    cwd: orchestratorCwd,
    stdio: 'ignore'
  });
  
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
    
    // Fallback kill
    setTimeout(() => {
      if (orchestratorProcess) {
        orchestratorProcess.kill();
        orchestratorProcess = null;
      }
    }, 1000);
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

ipcMain.handle('restart-backend', async (event, options) => {
  if (global.startLlamaServer) {
    await global.startLlamaServer(options?.useMesh || false);
    return { success: true };
  }
  return { success: false, error: 'startLlamaServer not found' };
});

app.whenReady().then(() => {
  startBackendProcesses();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (!serverProcess || !orchestratorProcess) {
        startBackendProcesses();
      }
      createWindow();
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
