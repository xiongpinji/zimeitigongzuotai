const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
const rootDir = path.resolve(__dirname, '..');
const electronDir = path.join(rootDir, 'node_modules', 'electron');

function getPlatformExecutable(platform = process.platform) {
  switch (platform) {
    case 'darwin':
    case 'mas':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'linux':
    case 'freebsd':
    case 'openbsd':
      return 'electron';
    case 'win32':
      return 'electron.exe';
    default:
      throw new Error(`Electron does not provide binaries for platform: ${platform}`);
  }
}

function isElectronInstalled({
  pathTxt,
  executableExists,
  versionFileExists,
  expectedExecutable,
}) {
  return pathTxt === expectedExecutable && executableExists && versionFileExists;
}

function readElectronInstallState({
  electronPackageDir = electronDir,
  platform = process.platform,
  existsSync = fs.existsSync,
  readFileSync = fs.readFileSync,
} = {}) {
  const expectedExecutable = getPlatformExecutable(platform);
  const pathTxtPath = path.join(electronPackageDir, 'path.txt');
  const distDir = path.join(electronPackageDir, 'dist');
  const pathTxt = existsSync(pathTxtPath)
    ? readFileSync(pathTxtPath, 'utf8').trim()
    : undefined;

  return {
    expectedExecutable,
    pathTxt,
    executableExists: existsSync(path.join(distDir, expectedExecutable)),
    versionFileExists: existsSync(path.join(distDir, 'version')),
  };
}

function buildElectronInstallEnv(baseEnv = process.env) {
  const configuredMirror =
    baseEnv.ELECTRON_MIRROR ||
    baseEnv.npm_config_electron_mirror ||
    baseEnv.NPM_CONFIG_ELECTRON_MIRROR ||
    ELECTRON_MIRROR;

  return {
    ...baseEnv,
    ELECTRON_MIRROR: configuredMirror,
    npm_config_electron_mirror: configuredMirror,
  };
}

function ensureElectronBinary({
  electronPackageDir = electronDir,
  env = process.env,
  stdio = 'inherit',
  spawn = spawnSync,
} = {}) {
  const state = readElectronInstallState({ electronPackageDir });
  if (isElectronInstalled(state)) {
    return;
  }

  const installScript = path.join(electronPackageDir, 'install.js');
  if (!fs.existsSync(installScript)) {
    throw new Error('Electron package is missing. Run npm install first.');
  }

  const installEnv = buildElectronInstallEnv(env);
  console.log(`[electron] Electron binary missing. Downloading from ${installEnv.ELECTRON_MIRROR}`);

  const result = spawn(process.execPath, [installScript], {
    cwd: rootDir,
    env: installEnv,
    stdio,
  });

  if (result.status !== 0) {
    throw new Error(`Electron binary install failed with exit code ${result.status ?? 'unknown'}`);
  }

  if (!isElectronInstalled(readElectronInstallState({ electronPackageDir }))) {
    throw new Error('Electron binary still missing after install.js reported success');
  }
}

if (require.main === module) {
  try {
    ensureElectronBinary();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  buildElectronInstallEnv,
  ensureElectronBinary,
  getPlatformExecutable,
  isElectronInstalled,
  readElectronInstallState,
};
