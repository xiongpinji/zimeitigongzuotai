// Strict offline product-readiness gate: an account-level throttle must pause sibling submissions.
// Calls the actual durable queue with its designed executor/reconciler injection ports.
// No platform modules, browser, account vault, model, media or network are loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { buildSync } = require('esbuild');

const repoRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.join(repoRoot, 'app');
const evidenceRoot = path.join(repoRoot, 'data', 'runtime', 'validation');
fs.mkdirSync(evidenceRoot, { recursive: true });
const runDir = fs.mkdtempSync(path.join(evidenceRoot, 'r6-account-cooldown-'));
const sourcePath = path.join(appRoot, 'electron', 'publish', 'durable-queue.ts');
const sourceSha256 = createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
const modulePath = path.join(runDir, 'durable-queue-probe.cjs');
buildSync({
  entryPoints: [sourcePath], bundle: true, platform: 'node', format: 'cjs',
  outfile: modulePath, logLevel: 'silent',
});
const { openDurableQueue } = require(modulePath);
const platforms = ['douyin', 'kuaishou', 'wechat-channels', 'xiaohongshu'];
const retryAfterMs = 45_000;

function createFixture(platform, mode, reopen) {
  let now = 1_700_000_000_000;
  const accountA = `synthetic-${platform}-alpha`;
  const accountB = `synthetic-${platform}-beta`;
  const calls = [];
  let firstOutcome = true;
  const storePath = path.join(runDir, `${platform}-${mode}-${reopen ? 'reopen' : 'same-process'}.json`);
  const options = {
    storePath, clock: () => now,
    budgets: { global: 1, device: 1, perAccount: 1 },
    executor: async (input) => {
      calls.push({ taskId: input.taskId, accountId: input.accountId, variantId: input.videoVariantId, at: now });
      if (firstOutcome) {
        firstOutcome = false;
        return mode === 'throttled'
          ? { kind: 'throttled', confirmedNotSubmitted: true, errorCode: 'simulated_account_rate_limit', retryAfterMs }
          : { kind: 'unknown', errorCode: 'simulated_unknown_submission' };
      }
      return { kind: 'submitted', remoteId: `synthetic-remote-${input.taskId}` };
    },
    reconciler: async () => ({ finalState: 'unknown', errorCode: 'simulated_lookup_pending' }),
  };
  const queue = openDurableQueue(options);
  const enqueue = (variantId, accountId) => {
    const jobs = queue.enqueueMatrix({
      videoVariantId: variantId, videoRef: `local://synthetic/${variantId}.mp4`,
      metadata: { title: '合成账号限流测试', description: '离线，不调用平台', tags: [], coverRefs: [], scheduleAt: null },
      accounts: [{ accountId, platform }], commerceRequest: null,
    });
    assert.equal(jobs.created.length, 1);
    now += 1; // Stable creation order independent of task-ID lexical ordering.
    return jobs.created[0];
  };
  const first = enqueue('synthetic-first', accountA);
  const sibling = enqueue('synthetic-sibling', accountA);
  const other = enqueue('synthetic-other', accountB);
  return { queue, options, calls, first, sibling, other, accountA, accountB, now: () => now, advance: (ms) => { now += ms; } };
}

async function checkCase(platform, mode, reopen) {
  const fixture = createFixture(platform, mode, reopen);
  let queue = fixture.queue;
  await queue.tick();
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].taskId, fixture.first.id);
  const firstState = queue.get(fixture.first.id);
  const throttleUntil = mode === 'throttled' ? fixture.now() + retryAfterMs : null;
  if (mode === 'throttled') {
    assert.equal(firstState.state, 'retryable_failure');
    assert.equal(firstState.nextAttemptAt, throttleUntil);
  } else {
    assert.equal(firstState.state, 'unknown_submission');
  }
  if (reopen) queue = openDurableQueue(fixture.options);
  const seenAfterRestart = queue.get(fixture.first.id);
  assert.deepEqual(seenAfterRestart, firstState);
  await queue.tick();
  await queue.tick();
  const subsequent = fixture.calls.slice(1);
  const siblingBeforeRelease = subsequent.some((call) => call.accountId === fixture.accountA);
  const otherAccountProgressed = subsequent.some((call) => call.accountId === fixture.accountB);
  const firstNotRetried = fixture.calls.filter((call) => call.taskId === fixture.first.id).length === 1;
  const observed = {
    platform, mode, reopened: reopen, retryAfterMs: mode === 'throttled' ? retryAfterMs : null,
    now: fixture.now(), throttleUntil, initialState: firstState.state,
    delayedTaskPreserved: seenAfterRestart.nextAttemptAt === firstState.nextAttemptAt,
    firstNotRetried, siblingBeforeRelease, otherAccountProgressed,
    siblingState: queue.get(fixture.sibling.id).state, callsBeforeRelease: [...fixture.calls],
    passed: firstNotRetried && !siblingBeforeRelease && otherAccountProgressed,
  };
  if (mode === 'throttled') {
    // Exercise the release boundary as an additional observation; it cannot repair an early submission.
    fixture.advance(retryAfterMs);
    await queue.tick();
    observed.releaseCheckAt = fixture.now();
    observed.firstRetriedAtRelease = fixture.calls.some((call) => call.taskId === fixture.first.id && call.at >= throttleUntil);
    observed.passed = observed.passed && observed.firstRetriedAtRelease;
  }
  observed.calls = [...fixture.calls];
  return observed;
}

async function main() {
  const throttled = [];
  const unknownControls = [];
  for (const platform of platforms) {
    for (const reopen of [false, true]) throttled.push(await checkCase(platform, 'throttled', reopen));
    unknownControls.push(await checkCase(platform, 'unknown', true));
  }
  assert.equal(createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'), sourceSha256);
  const report = {
    kind: 'offline_account_cooldown_readiness', sourceSha256, evidenceDir: runDir,
    criterion: 'An account-level throttle holds sibling submissions until the cooldown ends.',
    outcomeScopeAssumption: 'Account-level throttle is a product requirement; the current outcome contract has no scope field.',
    reopenMode: 'New queue object reading the same JSON store; not a process-crash test.',
    virtualClock: true,
    platformModulesLoaded: false, publicationAttempted: false, browserStarted: false,
    modelInvoked: false, simulatedExecutorOnly: true,
    existingTaskRetryAfterPassed: throttled.every((entry) => entry.firstNotRetried && entry.delayedTaskPreserved && entry.firstRetriedAtRelease),
    accountCooldownPassed: throttled.every((entry) => entry.passed),
    unknownControlsPassed: unknownControls.every((entry) => entry.passed),
    throttled, unknownControls,
    passed: [...throttled, ...unknownControls].every((entry) => entry.passed),
  };
  fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ evidenceDir: runDir, existingTaskRetryAfterPassed: report.existingTaskRetryAfterPassed,
    accountCooldownPassed: report.accountCooldownPassed, unknownControlsPassed: report.unknownControlsPassed,
    cases: [...throttled, ...unknownControls].map(({ platform, mode, reopened, firstNotRetried, siblingBeforeRelease, otherAccountProgressed, passed }) =>
      ({ platform, mode, reopened, firstNotRetried, siblingBeforeRelease, otherAccountProgressed, passed })), passed: report.passed }, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
