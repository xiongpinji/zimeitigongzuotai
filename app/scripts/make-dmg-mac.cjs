const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

const appName = packageJson.productName || packageJson.name;
const version = packageJson.version;
const releaseDir = path.join(rootDir, 'release');

const supportedArch = new Set(['arm64', 'x64']);
const arch = process.env.ARCH || process.arch;

if (!supportedArch.has(arch)) {
  console.error(`不支持的 macOS DMG 打包架构：${arch}`);
  console.error('请使用 ARCH=arm64 npm run dmg:mac 或 ARCH=x64 npm run dmg:mac');
  process.exit(1);
}

const appDir = path.join(releaseDir, `${appName}-darwin-${arch}`);
const appPath = path.join(appDir, `${appName}.app`);

if (!fs.existsSync(appPath)) {
  console.error(`未找到已打包的 .app：${path.relative(rootDir, appPath)}`);
  console.error('请先运行 npm run package:mac 或 npm run dist:mac');
  process.exit(1);
}

async function main() {
  const dmgName = `${appName}-${version}-${arch}`;
  const dmgPath = path.join(releaseDir, `${dmgName}.dmg`);

  // 清掉已有 .dmg 避免冲突
  await fsp.rm(dmgPath, { force: true });

  console.log(`开始打包 DMG：${appName} ${version} (${arch})`);

  // 创建临时目录作为 DMG 内容
  const stagingDir = path.join(releaseDir, `.dmg-staging-${arch}`);
  await fsp.rm(stagingDir, { recursive: true, force: true });
  await fsp.mkdir(stagingDir, { recursive: true });

  try {
    // 复制 .app 到临时目录
    console.log('复制 .app 到临时目录...');
    execFileSync('cp', ['-R', appPath, stagingDir]);

    // 创建 Applications 快捷方式
    execFileSync('ln', ['-s', '/Applications', path.join(stagingDir, 'Applications')]);

    // 使用 hdiutil 创建 DMG
    console.log('正在创建 DMG...');
    execFileSync('hdiutil', [
      'create',
      '-volname', appName,
      '-srcfolder', stagingDir,
      '-ov',
      '-format', 'UDZO',    // zlib 压缩
      '-imagekey', 'zlib-level=9',
      dmgPath,
    ], { stdio: 'inherit' });

    console.log(`DMG 打包完成：${path.relative(rootDir, dmgPath)}`);
  } finally {
    // 清理临时目录
    await fsp.rm(stagingDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('macOS DMG 打包失败');
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
