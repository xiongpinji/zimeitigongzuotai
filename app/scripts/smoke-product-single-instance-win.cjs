const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Run after `electron-vite build`; no installer or real account is involved.
if (process.platform !== 'win32') {
  throw new Error('This product-process smoke test requires Windows');
}

const repoRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.join(repoRoot, 'app');
const electronExecutable = path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const { _electron } = require(path.join(appRoot, 'node_modules', 'playwright'));
const validationDir = path.join(repoRoot, 'data', 'runtime', 'validation');
const profile = path.join(validationDir, 'product-single-instance-profile');
const output = path.join(validationDir, 'product-single-instance-smoke.json');
fs.mkdirSync(profile, { recursive: true });

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`second product instance did not exit in ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitForSecondInstance(owner, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const count = await owner.evaluate(() => globalThis.__productSecondInstanceEvents);
    if (count > 0) return count;
    if (Date.now() >= deadline) throw new Error('owner did not receive second-instance event');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function main() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let owner;
  let third;
  try {
    owner = await _electron.launch({
      executablePath: electronExecutable,
      args: [appRoot, `--user-data-dir=${profile}`],
      env,
      timeout: 60_000,
    });
    const ownerWindow = await owner.firstWindow({ timeout: 60_000 });
    await ownerWindow.waitForFunction(() => document.body.textContent?.includes('开始创作'), null, { timeout: 30_000 });
    const ownerTitle = await ownerWindow.title();
    const ownerProfile = await owner.evaluate(({ app }) => app.getPath('userData'));
    if (path.resolve(ownerProfile).toLowerCase() !== path.resolve(profile).toLowerCase()) {
      throw new Error('owner did not use isolated profile');
    }
    await owner.evaluate(({ app }) => {
      globalThis.__productSecondInstanceEvents = 0;
      app.on('second-instance', () => {
        globalThis.__productSecondInstanceEvents += 1;
      });
    });

    const loserStartedAt = Date.now();
    const loser = spawn(electronExecutable, [appRoot, `--user-data-dir=${profile}`], {
      env,
      windowsHide: true,
      stdio: 'ignore',
    });
    const loserResult = await waitForExit(loser, 30_000);
    const loserElapsedMs = Date.now() - loserStartedAt;
    const secondInstanceEvents = await waitForSecondInstance(owner, 10_000);
    const ownerWindowCountAfter = owner.windows().length;
    if (loserResult.code !== 0 || loserResult.signal !== null) {
      throw new Error(`loser exited abnormally: ${JSON.stringify(loserResult)}`);
    }
    if (secondInstanceEvents !== 1 || ownerWindowCountAfter !== 1) {
      throw new Error(`owner/loser invariant failed: events=${secondInstanceEvents}, windows=${ownerWindowCountAfter}`);
    }

    await owner.close();
    owner = undefined;
    third = await _electron.launch({
      executablePath: electronExecutable,
      args: [appRoot, `--user-data-dir=${profile}`],
      env,
      timeout: 60_000,
    });
    const thirdWindow = await third.firstWindow({ timeout: 60_000 });
    await thirdWindow.waitForFunction(() => document.body.textContent?.includes('开始创作'), null, { timeout: 30_000 });
    const thirdProfile = await third.evaluate(({ app }) => app.getPath('userData'));
    if (path.resolve(thirdProfile).toLowerCase() !== path.resolve(profile).toLowerCase()) {
      throw new Error('third instance did not reuse isolated profile');
    }
    const report = {
      ownerTitle,
      loserExitCode: loserResult.code,
      loserElapsedMs,
      secondInstanceEvents,
      ownerWindowCountAfter,
      thirdTitle: await thirdWindow.title(),
      isolatedProfile: true,
    };
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } finally {
    if (third) await third.close();
    if (owner) await owner.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
});
