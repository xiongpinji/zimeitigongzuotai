const fs = require('node:fs');
const path = require('node:path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const rootDir = path.resolve(__dirname, '..');
const targetDirs = ['dist', 'dist-electron'];
const supportedExtensions = new Set(['.js', '.cjs', '.mjs']);
const dynamicRuntimeMarkers = [
  '[lingji motion-card]',
  'Motion Card',
  'remotion:compile-cards',
  'compileMotionCards',
  'compiledCards',
  'new Function(',
];

// 跳过混淆的文件名（精确匹配 basename）。
// stealth.min.js 是第三方反检测脚本，混淆会破坏其运行时规避逻辑，且没有意义。
const SKIP_OBFUSCATION_BASENAMES = new Set(['stealth.min.js']);

const obfuscationOptions = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
};

function collectJavaScriptFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(entryPath));
      continue;
    }

    if (
      entry.isFile() &&
      supportedExtensions.has(path.extname(entry.name)) &&
      !SKIP_OBFUSCATION_BASENAMES.has(entry.name)
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

function shouldSkipObfuscation(filePath, sourceCode) {
  const relativePath = path.relative(rootDir, filePath).split(path.sep).join('/');
  const isBuildArtifact = targetDirs.some(
    (dir) => relativePath === dir || relativePath.startsWith(`${dir}/`),
  );
  if (!isBuildArtifact) {
    return null;
  }
  if (dynamicRuntimeMarkers.some((marker) => sourceCode.includes(marker))) {
    return `动态运行时代码：${relativePath}`;
  }
  return null;
}

function obfuscateFile(filePath) {
  const sourceCode = fs.readFileSync(filePath, 'utf8');
  const skipReason = shouldSkipObfuscation(filePath, sourceCode);
  if (skipReason) {
    console.log(`- 跳过混淆 ${path.relative(rootDir, filePath)}（${skipReason}）`);
    return false;
  }
  const result = JavaScriptObfuscator.obfuscate(sourceCode, {
    ...obfuscationOptions,
    inputFileName: path.relative(rootDir, filePath),
  });

  fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf8');
  return true;
}

function main() {
  const files = targetDirs.flatMap((dir) => collectJavaScriptFiles(path.join(rootDir, dir)));

  if (files.length === 0) {
    console.log('未找到可混淆的构建产物，跳过 JS 混淆。');
    return;
  }

  console.log(`开始混淆 ${files.length} 个 JS 构建产物...`);

  for (const filePath of files) {
    if (obfuscateFile(filePath)) {
      console.log(`- 已混淆 ${path.relative(rootDir, filePath)}`);
    }
  }

  console.log('JS 混淆完成。');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('JS 混淆失败');
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  dynamicRuntimeMarkers,
  obfuscationOptions,
  shouldSkipObfuscation,
};
