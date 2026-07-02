const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(path.join(__dirname, '../..'));

function runCommand(command, cwd) {
  console.log(`Running: ${command} inside ${cwd}`);
  execSync(command, { cwd, stdio: 'inherit' });
}

try {
  console.log('\n=== Step 1: Building SvelteKit Frontend ===');
  runCommand('npm run build', path.join(rootDir, 'tools/ui'));

  console.log('\n=== Step 2: Compiling Python Orchestrator with PyInstaller ===');
  // Copy providers.json and swarm_configs.json if they don't exist in dist
  const orchestratorDir = path.join(rootDir, 'tools/orchestrator');
  runCommand('python -m PyInstaller --onefile --clean -n orchestrator main.py', orchestratorDir);

  console.log('\n=== Step 3: Installing Electron Wrapper Dependencies ===');
  runCommand('npm install', __dirname);

  console.log('\n=== Step 4: Packaging Electron App ===');
  runCommand('npm run build', __dirname);

  console.log('\n=== SUCCESS ===');
  console.log(`Installer created successfully using electron-builder!`);
} catch (error) {
  console.error('\n=== BUILD FAILED ===');
  console.error(error);
  process.exit(1);
}
