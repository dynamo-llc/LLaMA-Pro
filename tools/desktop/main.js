const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const serve = require('electron-serve');

const loadURL = serve({ directory: path.join(__dirname, 'ui-dist') });

let mainWindow = null;
let serverProcess = null;
let orchestratorProcess = null;

function startBackendProcesses() {
  const isPackaged = app.isPackaged;
  
  // Resolve paths for executables
  const binDir = isPackaged
    ? path.resolve(path.join(process.resourcesPath, '../../bin'))
    : path.resolve(path.join(__dirname, '../../build/bin'));
    
  const serverPath = path.join(binDir, 'llama-server.exe');
  
  const orchestratorPath = isPackaged
    ? path.join(binDir, 'orchestrator.exe')
    : path.resolve(path.join(__dirname, '../../.venv/Scripts/python.exe'));
    
  const orchestratorArgs = isPackaged
    ? []
    : [path.resolve(path.join(__dirname, '../orchestrator/main.py'))];

  console.log(`Starting C++ backend from: ${serverPath}`);
  serverProcess = spawn(serverPath, ['--port', '8080', '--host', '127.0.0.1'], {
    cwd: binDir,
    stdio: 'ignore'
  });
  
  serverProcess.on('error', (err) => {
    console.error('Failed to start llama-server process:', err);
  });
  
  console.log(`Starting Python orchestrator from: ${orchestratorPath}`);
  orchestratorProcess = spawn(orchestratorPath, orchestratorArgs, {
    cwd: isPackaged ? binDir : path.resolve(path.join(__dirname, '../orchestrator')),
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
  if (orchestratorProcess) {
    orchestratorProcess.kill();
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

app.whenReady().then(() => {
  startBackendProcesses();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopBackendProcesses();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
