import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  assertSingleInstanceBuild,
} = require('../scripts/assert-single-instance-build.cjs');

const OWNER_ASSERTION = 'Single-instance lock owner required';
const GATE_CHUNK = 'single-instance-gate-C9CUo8QZ.js';
const SCRIPT_PATH = path.resolve(__dirname, '../scripts/assert-single-instance-build.cjs');

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    const resolved = path.resolve(dir);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith('lingji-single-instance-build-')
    ) {
      throw new Error('unexpected fixture cleanup target');
    }
    rmSync(resolved, { recursive: true, force: true });
  }
});

function makeFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lingji-single-instance-build-'));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, ...name.split('/'));
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  }
  return dir;
}

function gateChunkSource(text: string = OWNER_ASSERTION): string {
  return [
    '"use strict";',
    'let owner = false;',
    `function assertSingleInstanceOwner() { if (!owner) { throw new Error(${JSON.stringify(text)}); } }`,
    'module.exports = { assertSingleInstanceOwner };',
  ].join('\n');
}

function lazyMainSource(options: { gateRef?: string; lazyExpression?: string } = {}): string {
  const gateRef = options.gateRef ?? `./${GATE_CHUNK}`;
  const lazyExpression =
    options.lazyExpression ?? 'Promise.resolve().then(() => require("./app-main.js"))';
  return [
    '"use strict";',
    'const electron = require("electron");',
    `const gate = require('${gateRef}');`,
    'void gate.runSingleInstanceGate({',
    '  app: electron.app,',
    `  loadMainRuntime: () => ${lazyExpression},`,
    '}).catch((error) => { console.error(error); electron.app.exit(1); });',
  ].join('\n');
}

function appMainSource(options: { gateRef?: string } = {}): string {
  const gateRef = options.gateRef ?? `./${GATE_CHUNK}`;
  return [
    '"use strict";',
    'const electron = require("electron");',
    `const gate = require(${JSON.stringify(gateRef)});`,
    'module.exports = { electron, gate };',
  ].join('\n');
}

function validFixture(options: { gateChunkName?: string } = {}): Record<string, string> {
  const gateChunkName = options.gateChunkName ?? GATE_CHUNK;
  return {
    'main.js': lazyMainSource({ gateRef: `./${gateChunkName}` }),
    'app-main.js': appMainSource({ gateRef: `./${gateChunkName}` }),
    [gateChunkName]: gateChunkSource(),
  };
}

function failureMessage(dir: string, pattern: RegExp): string {
  let message = '';
  try {
    assertSingleInstanceBuild(dir);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).not.toBe('');
  expect(message).toMatch(pattern);
  expect(message).not.toContain(dir);
  expect(message).not.toContain(os.tmpdir());
  return message;
}

describe('assert-single-instance-build build gate', () => {
  it('passes and resolves the shared gate chunk when both entries require one existing lazy gate chunk', () => {
    const dir = makeFixture(validFixture());
    expect(assertSingleInstanceBuild(dir)).toEqual({ gateChunk: GATE_CHUNK });
  });

  it('accepts a native import() lazy load with alternate quote styles and an arbitrary chunk hash', () => {
    const gateChunkName = 'single-instance-gate-DifferentHash.js';
    const dir = makeFixture({
      'main.js': lazyMainSource({
        gateRef: `./${gateChunkName}`,
        lazyExpression: "import('./app-main.js')",
      }),
      'app-main.js': appMainSource({ gateRef: `./${gateChunkName}` }),
      [gateChunkName]: gateChunkSource(),
    });
    expect(assertSingleInstanceBuild(dir)).toEqual({ gateChunk: gateChunkName });
  });

  it('accepts a function-return Promise/then require and a different require order', () => {
    const gateChunkName = 'single-instance-gate-Reordered.js';
    const dir = makeFixture({
      'main.js': lazyMainSource({
        gateRef: `./${gateChunkName}`,
        lazyExpression:
          'Promise.resolve().then(function () { return require("./app-main.js"); })',
      }),
      'app-main.js': appMainSource({ gateRef: `./${gateChunkName}` }),
      [gateChunkName]: gateChunkSource(),
    });
    expect(assertSingleInstanceBuild(dir)).toEqual({ gateChunk: gateChunkName });
  });

  it('ignores unreferenced stale chunks, even a stale chunk that still contains the assertion', () => {
    const dir = makeFixture({
      ...validFixture(),
      'single-instance-gate-STALE.js': gateChunkSource(),
      'orphan-chunk.js': 'require("./single-instance-gate-STALE.js");',
    });
    expect(assertSingleInstanceBuild(dir)).toEqual({ gateChunk: GATE_CHUNK });
  });

  it('fails when app-main.js is missing', () => {
    const files = validFixture();
    delete files['app-main.js'];
    const dir = makeFixture(files);
    const message = failureMessage(dir, /missing main runtime entry: dist-electron\/app-main\.js/);
    expect(failureMessage(dir, /missing main runtime entry/)).toBe(message);
  });

  it('fails when main.js eagerly requires app-main.js at top level', () => {
    const dir = makeFixture({
      'main.js': [
        '"use strict";',
        'const electron = require("electron");',
        `const gate = require("./${GATE_CHUNK}");`,
        'const appMain = require("./app-main.js");',
        'void gate.runSingleInstanceGate({ app: electron.app, loadMainRuntime: () => appMain });',
      ].join('\n'),
      'app-main.js': appMainSource(),
      [GATE_CHUNK]: gateChunkSource(),
    });
    failureMessage(dir, /eagerly requires \.\/app-main\.js at top level/);
  });

  it('fails when app-main import starts before the gate instead of in loadMainRuntime', () => {
    const dir = makeFixture({
      'main.js': [
        '"use strict";',
        'const electron = require("electron");',
        `const gate = require("./${GATE_CHUNK}");`,
        'const premature = import("./app-main.js");',
        'void premature;',
        'void gate.runSingleInstanceGate({ app: electron.app, loadMainRuntime: () => undefined });',
      ].join('\n'),
      'app-main.js': appMainSource(),
      [GATE_CHUNK]: gateChunkSource(),
    });
    failureMessage(dir, /does not lazily load \.\/app-main\.js/);
  });

  it('fails when main.js no longer references app-main.js at all', () => {
    const dir = makeFixture({
      'main.js': [
        '"use strict";',
        'const electron = require("electron");',
        `const gate = require("./${GATE_CHUNK}");`,
        'void gate.runSingleInstanceGate({ app: electron.app, loadMainRuntime: () => undefined });',
      ].join('\n'),
      'app-main.js': appMainSource(),
      [GATE_CHUNK]: gateChunkSource(),
    });
    failureMessage(dir, /does not lazily load \.\/app-main\.js/);
  });

  it('fails when main.js and app-main.js require different gate chunks', () => {
    const dir = makeFixture({
      'main.js': lazyMainSource({ gateRef: './single-instance-gate-main.js' }),
      'app-main.js': appMainSource({ gateRef: './single-instance-gate-app.js' }),
      'single-instance-gate-main.js': gateChunkSource(),
      'single-instance-gate-app.js': gateChunkSource(),
    });
    failureMessage(dir, /uses a different single-instance gate chunk than main\.js/);
  });

  it('fails when the shared gate chunk is missing even though a stale gate chunk exists', () => {
    const dir = makeFixture({
      'main.js': lazyMainSource({ gateRef: './single-instance-gate-current.js' }),
      'app-main.js': appMainSource({ gateRef: './single-instance-gate-current.js' }),
      'single-instance-gate-STALE.js': gateChunkSource(),
    });
    failureMessage(
      dir,
      /missing referenced chunk\(s\): single-instance-gate-current\.js/,
    );
  });

  it('fails when the shared gate chunk lost the owner assertion text', () => {
    const dir = makeFixture({
      'main.js': lazyMainSource(),
      'app-main.js': appMainSource(),
      [GATE_CHUNK]: gateChunkSource('Single-instance lock owner is required (renamed)'),
    });
    failureMessage(dir, /lost owner assertion/);
  });

  it('fails when multiple shared chunks retain the owner assertion', () => {
    const dir = makeFixture({
      'main.js': [
        '"use strict";',
        'const electron = require("electron");',
        'const gateA = require("./single-instance-gate-a.js");',
        'const gateB = require("./single-instance-gate-b.js");',
        'void gateA.runSingleInstanceGate({',
        '  app: electron.app,',
        '  loadMainRuntime: () => Promise.resolve().then(() => require("./app-main.js")),',
        '});',
        'void gateB;',
      ].join('\n'),
      'app-main.js': [
        '"use strict";',
        'const gateA = require("./single-instance-gate-a.js");',
        'const gateB = require("./single-instance-gate-b.js");',
        'module.exports = { gateA, gateB };',
      ].join('\n'),
      'single-instance-gate-a.js': gateChunkSource(),
      'single-instance-gate-b.js': gateChunkSource(),
    });
    failureMessage(dir, /ambiguous single-instance gate references/);
  });

  it('fails when the gate module is duplicated inside an entry file', () => {
    const dir = makeFixture({
      'main.js': [
        lazyMainSource(),
        `const inlineCopy = ${JSON.stringify(OWNER_ASSERTION)};`,
        'void inlineCopy;',
      ].join('\n'),
      'app-main.js': appMainSource(),
      [GATE_CHUNK]: gateChunkSource(),
    });
    failureMessage(dir, /gate module duplicated across bundle files/);
  });

  it('exits zero on a valid fixture and nonzero with a fixed diagnostic on a broken fixture', () => {
    const validDir = makeFixture(validFixture());
    const ok = spawnSync(process.execPath, [SCRIPT_PATH, validDir], { encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('OK');

    const brokenFiles = validFixture();
    delete brokenFiles['app-main.js'];
    const brokenDir = makeFixture(brokenFiles);
    const bad = spawnSync(process.execPath, [SCRIPT_PATH, brokenDir], { encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('missing main runtime entry: dist-electron/app-main.js');
    expect(bad.stderr).not.toContain(brokenDir);
  });
});
