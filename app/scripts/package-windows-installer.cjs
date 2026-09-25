const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Windows NSIS 安装包生成：把 @electron/packager 产出的免安装文件夹打成 Setup.exe。
// 安装到 $PROGRAMFILES64\<appName>（短根路径），从根本上规避用户自行解压到深目录
// 触发的 MAX_PATH(260) 运行期路径过长问题；同时提供开始菜单/桌面快捷方式与卸载项。

const UNINSTALL_REGISTRY_ROOT = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';

// 与 make-dmg-mac.cjs 保持一致的发布产物命名：<appName>-<version>-<arch>-setup.exe。
function resolveInstallerOutputName({ appName, version, arch }) {
  return `${appName}-${version}-${arch}-setup.exe`;
}

// 优先使用 MAKENSIS 环境变量指定的 makensis 路径，否则回退到 PATH 中的 makensis。
function resolveMakensisCommand(env = process.env) {
  const explicit = (env.MAKENSIS || '').trim();
  return explicit || 'makensis';
}

function toWindowsPath(p) {
  return p.split('/').join('\\');
}

// 生成 NSIS 脚本。所有界面文案用简体中文；中文路径与文件名依赖 Unicode true。
function buildNsisScript({
  appName,
  version,
  arch,
  appDir,
  exeName,
  iconPath,
  outFile,
  publisher = appName,
}) {
  const winAppDir = toWindowsPath(appDir);
  const winOutFile = toWindowsPath(outFile);
  const uninstallKey = `${UNINSTALL_REGISTRY_ROOT}\\${appName}`;
  const iconLine = iconPath
    ? `!define MUI_ICON "${toWindowsPath(iconPath)}"\n!define MUI_UNICON "${toWindowsPath(iconPath)}"`
    : '';

  return `Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma

!include "MUI2.nsh"

Name "${appName}"
OutFile "${winOutFile}"
InstallDir "$PROGRAMFILES64\\${appName}"
InstallDirRegKey HKLM "Software\\${appName}" "InstallDir"
RequestExecutionLevel admin

${iconLine}

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\\${exeName}"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${winAppDir}\\*.*"

  WriteRegStr HKLM "Software\\${appName}" "InstallDir" "$INSTDIR"

  WriteRegStr HKLM "${uninstallKey}" "DisplayName" "${appName}"
  WriteRegStr HKLM "${uninstallKey}" "DisplayVersion" "${version}"
  WriteRegStr HKLM "${uninstallKey}" "DisplayIcon" "$INSTDIR\\${exeName}"
  WriteRegStr HKLM "${uninstallKey}" "Publisher" "${publisher}"
  WriteRegStr HKLM "${uninstallKey}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${uninstallKey}" "UninstallString" "$INSTDIR\\Uninstall.exe"
  WriteRegDWORD HKLM "${uninstallKey}" "NoModify" 1
  WriteRegDWORD HKLM "${uninstallKey}" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\\${appName}"
  CreateShortcut "$SMPROGRAMS\\${appName}\\${appName}.lnk" "$INSTDIR\\${exeName}"
  CreateShortcut "$DESKTOP\\${appName}.lnk" "$INSTDIR\\${exeName}"

  WriteUninstaller "$INSTDIR\\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\\${appName}.lnk"
  RMDir /r "$SMPROGRAMS\\${appName}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "${uninstallKey}"
  DeleteRegKey HKLM "Software\\${appName}"
SectionEnd
`;
}

function runMakensis(command, scriptPath, cwd) {
  return new Promise((resolve, reject) => {
    // Windows 上 makensis 多为 .exe；若用户用 .bat/.cmd 包装则需 shell。
    const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
    const child = spawn(command, [scriptPath], {
      cwd,
      stdio: 'inherit',
      shell: useShell,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`makensis 退出码 ${code}`));
    });
  });
}

function makensisMissingMessage(command) {
  return [
    `未找到 NSIS（makensis）：${command}`,
    '安装包生成需要 NSIS。请安装后重试：',
    '  Windows: choco install nsis  或  https://nsis.sourceforge.io/Download',
    '  macOS:   brew install makensis',
    '已安装但不在 PATH 时，可用环境变量指定：MAKENSIS="C:\\Program Files (x86)\\NSIS\\makensis.exe"',
  ].join('\n');
}

async function createWindowsInstaller({
  appName,
  version,
  arch,
  appDir,
  iconPath,
  releaseDir,
  tmpDir,
  env = process.env,
}) {
  if (!fs.existsSync(appDir)) {
    throw new Error(`找不到待打包的应用目录：${appDir}`);
  }

  const exeName = `${appName}.exe`;
  if (!fs.existsSync(path.join(appDir, exeName))) {
    throw new Error(`应用目录缺少可执行文件：${exeName}`);
  }

  const outName = resolveInstallerOutputName({ appName, version, arch });
  const outFile = path.join(releaseDir, outName);
  const command = resolveMakensisCommand(env);

  const scriptText = buildNsisScript({
    appName,
    version,
    arch,
    appDir,
    exeName,
    iconPath: iconPath && fs.existsSync(iconPath) ? iconPath : undefined,
    outFile,
  });

  await fsp.mkdir(tmpDir, { recursive: true });
  const scriptPath = path.join(tmpDir, 'installer.nsi');
  await fsp.writeFile(scriptPath, scriptText, 'utf8');

  try {
    await runMakensis(command, scriptPath, tmpDir);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(makensisMissingMessage(command));
    }
    throw error;
  }

  if (!fs.existsSync(outFile)) {
    throw new Error(`安装包生成失败，未找到产物：${outFile}`);
  }
  return outFile;
}

module.exports = {
  UNINSTALL_REGISTRY_ROOT,
  resolveInstallerOutputName,
  resolveMakensisCommand,
  buildNsisScript,
  makensisMissingMessage,
  createWindowsInstaller,
};
