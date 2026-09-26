'use strict';

/**
 * Q2-R3a 预混淆构建门槛：核验 dist-electron 产物仍满足单实例顺序契约。
 *
 * 三个不变量（任一不成立即抛错，退出码 1，绝不静默通过）：
 * 1. 薄入口 main.js 通过 import() 或 Promise/then 包裹的 require 懒加载
 *    ./app-main.js，且没有顶层静态 require 该入口；
 * 2. main.js 与 app-main.js 引用同一个共享 gate chunk（同一模块实例）；
 * 3. 该共享 gate chunk 仍保留 owner 断言文案 'Single-instance lock owner required'。
 *
 * 只解析两个入口文件里真实出现的引用，不扫描整个 dist-electron——
 * emptyOutDir:false 会残留旧 chunk，全目录搜索会假阳性通过。
 *
 * 用法：node scripts/assert-single-instance-build.cjs [dist-electron 目录]
 * 不传目录时检查 <app>/dist-electron。必须在 JS 混淆之前运行（混淆会拆分字符串字面量）。
 */

const fs = require('node:fs');
const path = require('node:path');

const OWNER_ASSERTION_TEXT = 'Single-instance lock owner required';
const MAIN_ENTRY_FILE = 'main.js';
const APP_MAIN_ENTRY_FILE = 'app-main.js';
const APP_MAIN_SPECIFIER = 'app-main.js';

function buildAssertionError(message) {
  return new Error(message);
}

function readTextFileIfPresent(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return null;
    }
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function normalizeSpecifier(specifier) {
  return String(specifier).replace(/\\/g, '/').replace(/^\.\//, '');
}

function collectReferences(source) {
  const references = [];
  const patterns = [
    { kind: 'require', pattern: /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g },
    { kind: 'import', pattern: /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g },
  ];
  for (const { kind, pattern } of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      references.push({
        kind,
        raw: match[2],
        specifier: normalizeSpecifier(match[2]),
        index: match.index,
      });
    }
  }
  return references;
}

function isDeferredRequire(source, index) {
  const lookbehind = source.slice(Math.max(0, index - 200), index);
  return (
    /=>\s*$/.test(lookbehind) || /function\s*\([^()]*\)\s*\{\s*return\s*$/.test(lookbehind)
  );
}

function assertThinEntryLoadsAppMainLazily(mainSource) {
  const appMainReferences = collectReferences(mainSource).filter(
    (reference) => reference.specifier === APP_MAIN_SPECIFIER,
  );
  const eagerReferences = appMainReferences.filter(
    (reference) => reference.kind === 'require' && !isDeferredRequire(mainSource, reference.index),
  );
  if (eagerReferences.length > 0) {
    throw buildAssertionError(
      'thin entry eagerly requires ./app-main.js at top level; app-main must stay behind the single-instance gate',
    );
  }
  // One reference must belong to the gate's loader itself. A top-level import()
  // begins loading app-main before the lock even though it is syntactically dynamic.
  const loader = /\bloadMainRuntime\s*:\s*(?:async\s*)?\(\s*\)\s*=>\s*/.exec(mainSource);
  const loaderBody = loader ? mainSource.slice(loader.index + loader[0].length) : '';
  const directImport = /^import\s*\(\s*(['"])\.\/app-main\.js\1\s*\)/.test(loaderBody);
  const deferredRequire = /^Promise\.resolve\s*\(\s*\)\s*\.then\s*\(\s*(?:\(\s*\)\s*=>\s*|function\s*\(\s*\)\s*\{\s*return\s*)require\s*\(\s*(['"])\.\/app-main\.js\1\s*\)/.test(loaderBody);
  if (appMainReferences.length !== 1 || (!directImport && !deferredRequire)) {
    throw buildAssertionError(
      'thin entry does not lazily load ./app-main.js (expected import() or Promise/then-wrapped require)',
    );
  }
}

function collectLocalChunkReferences(source) {
  const specifiers = new Set();
  for (const reference of collectReferences(source)) {
    if (!reference.raw.startsWith('.')) {
      continue;
    }
    if (reference.specifier === APP_MAIN_SPECIFIER) {
      continue;
    }
    specifiers.add(reference.specifier);
  }
  return specifiers;
}

function resolveChunkPath(distDir, specifier) {
  const segments = specifier.split('/');
  if (segments.length === 0 || segments.some((segment) => segment === '' || segment === '..')) {
    return null;
  }
  const resolved = path.resolve(distDir, ...segments);
  const relative = path.relative(distDir, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}

function collectGateSources(entryFile, entrySource, chunkRefs, chunkSources) {
  const sources = [];
  if (entrySource.includes(OWNER_ASSERTION_TEXT)) {
    sources.push(entryFile);
  }
  for (const ref of [...chunkRefs].sort()) {
    if (chunkSources.get(ref).includes(OWNER_ASSERTION_TEXT)) {
      sources.push(ref);
    }
  }
  return sources;
}

function assertSingleInstanceBuild(distDir) {
  if (typeof distDir !== 'string' || distDir.length === 0) {
    throw buildAssertionError('dist-electron directory argument is required');
  }

  const mainSource = readTextFileIfPresent(path.join(distDir, MAIN_ENTRY_FILE));
  if (mainSource === null) {
    throw buildAssertionError(`missing main entry: dist-electron/${MAIN_ENTRY_FILE}`);
  }
  const appMainSource = readTextFileIfPresent(path.join(distDir, APP_MAIN_ENTRY_FILE));
  if (appMainSource === null) {
    throw buildAssertionError(
      `missing main runtime entry: dist-electron/${APP_MAIN_ENTRY_FILE}`,
    );
  }

  assertThinEntryLoadsAppMainLazily(mainSource);

  const mainRefs = collectLocalChunkReferences(mainSource);
  const appMainRefs = collectLocalChunkReferences(appMainSource);

  const allRefs = [...new Set([...mainRefs, ...appMainRefs])].sort();
  const chunkSources = new Map();
  const missingRefs = [];
  for (const ref of allRefs) {
    const resolved = resolveChunkPath(distDir, ref);
    const source = resolved === null ? null : readTextFileIfPresent(resolved);
    if (source === null) {
      missingRefs.push(ref);
    } else {
      chunkSources.set(ref, source);
    }
  }
  if (missingRefs.length > 0) {
    throw buildAssertionError(`missing referenced chunk(s): ${missingRefs.join(', ')}`);
  }

  const sharedRefs = allRefs.filter((ref) => mainRefs.has(ref) && appMainRefs.has(ref));
  const mainGateSources = collectGateSources(
    MAIN_ENTRY_FILE,
    mainSource,
    mainRefs,
    chunkSources,
  );
  const appMainGateSources = collectGateSources(
    APP_MAIN_ENTRY_FILE,
    appMainSource,
    appMainRefs,
    chunkSources,
  );
  const allGateSources = [
    ...new Set([...mainGateSources, ...appMainGateSources]),
  ].sort();
  const sharedGateRefs = sharedRefs.filter((ref) =>
    chunkSources.get(ref).includes(OWNER_ASSERTION_TEXT),
  );

  if (sharedGateRefs.length > 1) {
    throw buildAssertionError(
      `ambiguous single-instance gate references: multiple shared chunks contain the owner assertion: ${sharedGateRefs.join(', ')}`,
    );
  }

  if (sharedGateRefs.length === 1) {
    if (allGateSources.length > 1) {
      throw buildAssertionError(
        `single-instance gate module duplicated across bundle files: ${allGateSources.join(', ')}`,
      );
    }
    return { gateChunk: sharedGateRefs[0] };
  }

  if (mainGateSources.length > 0 && appMainGateSources.length > 0) {
    throw buildAssertionError(
      `app-main.js uses a different single-instance gate chunk than main.js: main.js -> ${mainGateSources.join(', ')}, app-main.js -> ${appMainGateSources.join(', ')}`,
    );
  }
  if (sharedRefs.length === 0) {
    throw buildAssertionError(
      'main.js and app-main.js do not share a single-instance gate chunk',
    );
  }
  throw buildAssertionError(
    `single-instance gate chunk lost owner assertion: '${OWNER_ASSERTION_TEXT}' not found in shared chunk(s): ${sharedRefs.join(', ')}`,
  );
}

function main() {
  const distDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '..', 'dist-electron');
  try {
    const result = assertSingleInstanceBuild(distDir);
    console.log(
      `[assert-single-instance-build] OK: shared gate chunk ${result.gateChunk} retains the owner assertion`,
    );
  } catch (error) {
    console.error('[assert-single-instance-build] 构建产物不满足单实例顺序契约（预混淆门槛）：');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  APP_MAIN_ENTRY_FILE,
  APP_MAIN_SPECIFIER,
  MAIN_ENTRY_FILE,
  OWNER_ASSERTION_TEXT,
  assertSingleInstanceBuild,
  collectLocalChunkReferences,
  collectReferences,
  isDeferredRequire,
};
