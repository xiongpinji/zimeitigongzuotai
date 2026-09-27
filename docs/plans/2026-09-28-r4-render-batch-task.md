# Objective

Implement R4 B1: render persisted editable composition versions through a bounded, recoverable batch service. At least three existing independent version projects must become independent per-version render results, using the existing source verifier and headless Remotion export path. This task does not register IPC, expose UI, publish media, or approve quality/originality. Work from baseline `199b19e` in the assigned clean WSL worktree.

# Why

Current R4 modules persist three version projects but there is no `render-batch.ts`. The synthetic smoke only renders one timeline. R6 secure-account publishing needs trusted render artifacts rather than renderer-supplied paths. The confirmed R4 spec requires two-worker limits, cancellation, failure isolation, revalidation and recovery without blind rerendering. The existing `renderVideoHeadless` has no AbortSignal and temporarily changes cwd in packaged builds, so cancellation and packaged concurrency must be handled in the shared path without changing legacy default export settings.

# Scope

Allowed paths only:

- `app/electron/composition/render-batch.ts` (new service)
- `app/tests/composition-render-batch.test.ts` (new behavior suite)
- `app/electron/remotion/render-video-headless.ts` (only optional cancellation/frame-concurrency and packaged-call serialization)
- `app/electron/remotion/render.ts` (only optional AbortSignal to Remotion cancellation)
- `app/tests/render-video-headless-cancel.test.ts` (new focused mocked dependency tests)
- `app/tests/remotion-render-cancel.test.ts` (new focused Remotion port tests)

Do not modify existing tests or assert weaker thresholds. Do not change source resolver, version persistence schema, timeline builder, main/preload/UI, queue, accounts, production contracts, dependencies, package files, lockfiles, configuration, user-data or other worktrees. The preprovided Linux `app/node_modules` link is baseline infrastructure owned by Codex; do not alter it or create additional links. If more paths are necessary, stop and ask through the job question channel before touching them.

# Files to inspect

- `AGENTS.md`, `app/AGENTS.md`, `app/CLAUDE.md`: repository boundaries and existing export/telemetry conventions.
- `docs/superpowers/specs/2026-09-28-r4-multi-version-composition-design.md` and `docs/superpowers/plans/2026-09-28-r4-multi-version-composition.md`: confirmed R4 requirements, especially tasks 3–6.
- `app/electron/composition/version-projects.ts`: `readCompositionVersion`, `CompositionVersionRecord`, safe project/batch/version resolution, manifest plan/source hashes and `timelineModified`. These remain the authority for reading project paths.
- `app/electron/composition/source-resolver.ts`: `resolveCompositionSources`, `CompositionSourceServices` and `CompositionSourceInput`; reviewed receipt IDs come from manifest segments; no arbitrary media paths may enter from callers.
- `app/electron/composition/timeline-builder.ts`: normal editable video/audio/text/B-roll timeline shapes. Preserve the stored editable timeline rather than replace it with a second render-only representation.
- `app/electron/remotion/render-video-headless.ts`: `RenderVideoArgs`, `renderVideoHeadless`, cleanup/telemetry and packaged cwd change. Existing calls without new options must retain behavior.
- `app/electron/remotion/render.ts`: `renderRemotionVideo` and `RemotionRenderParams`; installed `@remotion/renderer` exports `makeCancelSignal()` with `cancelSignal` and `cancel()`; `renderMedia` accepts `cancelSignal`.
- `app/src/lib/export-settings.ts`: existing ExportConfig values and default export behavior; do not invent a new export schema.
- `app/tests/composition-version-projects.test.ts`, `app/tests/composition-source-resolver.test.ts`, `app/tests/composition-timeline-builder.test.ts`, `app/tests/export-run.test.ts`: fixture and injectable-port patterns. Use fresh small synthetic data; no real media.

# Implementation guidance

1. Write the new behavior tests first and execute them before implementing. A missing module/export RED is acceptable initially; after creating the API skeleton, prove failure paths with real state/files, not just source-text matching. Never claim tests ran if a dependency or permission blocks them.
2. Export `createCompositionRenderBatch(deps)` returning `run(input)`, `read(location)` and `cancel(projectDir,batchId)` methods. `input` uses `projectDir`, `batchId`, `planIds` (nonempty unique IDs), existing `ExportConfig`, and `context: Omit<AssetUsageContext,'usedAt'>`; expose optional explicit `retryFailed` for previously confirmed failures only. Deps contain trusted `getDocument()` and `sourceServices: CompositionSourceServices`, injectable `render` for tests, and a clock for durable timestamps. The default renderer must lazily call the real `renderVideoHeadless`. Input must never contain a renderer-supplied output path or source-verification result.
3. Read each version through `readCompositionVersion`; reject modified timelines with stable `review_required`. Load the trusted production document and call `resolveCompositionSources` immediately before rendering **and before reusing a completed artifact**. Derive clip selections from `manifest.sources.segments[].clip.receiptId`. Use input context with the trusted service clock; never accept a backdated `usedAt`. Verify refreshed media identity agrees with stored version (segment IDs/order, receipt/highlight/recording IDs, source/output hashes, source ranges, asset IDs/hashes and visual placement). Require trusted path bindings to remain consistent; fail clearly if relocation would require a new timeline binding. Do not treat changing verification time as content change.
4. Compute an input fingerprint from the plan hash, current timeline, export config and verified media identity. Exclude only volatile verification time; include platform/region/commercial usage and all content identity. Keep fresh rights/source evidence in the internal record. Unreviewed edits, changed source bytes or revoked/expired permissions must stop the version even if a prior completed MP4 exists.
5. Use a single in-process ownership map keyed by canonical batch/version location and a global semaphore capped at two active renders across service instances/batches. `run` on an already active batch must fail with `batch_busy`; do not let a new service instance rewrite its live state. Cross-OS-process safety is outside this module; eventual production caller is the existing single-instance main process. Document this boundary accurately.
6. Save one version-local `render-state.json` (schemaVersion 1) with IDs, state (`queued`, `rendering`, `completed`, `failed`, `cancelled`, `unknown`), attempt ID, input fingerprint, source identity/timeline hashes, timestamps, stable error code and optional output SHA-256. State is main-process-only and may retain verified internal paths. Reject symlink/nonregular/corrupt state files and unsafe paths. Use atomic same-directory writes with fsync/rename; no resetting corrupt state. Do not overwrite a valid root or version `project.json`/manifest. Render into a unique own temporary MP4 in the validated version directory; commit it to a version-local derived output name only after completion and file hashing. Verify output is regular/non-symlink and do not overwrite an unrelated or tampered artifact.
7. A fresh service reading a leftover `rendering` attempt must expose/persist `unknown`; `run` preserves unknown with no renderer call. Never automatically turn it into failed or rerender it. Completed output is reused only when fingerprint and file hash match after fresh source/rights checks; tampered output fails without overwrite. Known `failed`/`cancelled` entries are not automatically retried unless the caller explicitly requests permitted retry; unknown is never covered by `retryFailed`. Keep one version error from stopping the other valid versions.
8. Cancellation stops new versions, aborts in-flight render calls, and waits for their Promises to settle before releasing the semaphore or touching temporary output. No late completion may overwrite a cancelled/unknown decision. Add optional `signal` to `renderVideoHeadless` and `renderRemotionVideo`; connect AbortSignal to installed Remotion `makeCancelSignal`/`renderMedia`, check abort before/after expensive stages, detach listeners, and preserve cleanup in finally. `selectComposition` lacks this cancellation port; ensure it cannot proceed to render after cancellation. Do not claim an active render stopped just because a flag changed.
9. Preserve old export defaults. For batch calls, pass a bounded per-render frame-concurrency option to avoid two exports each consuming all cores; validate the optional override. Packaged `process.chdir` is process-global: serialize packaged headless invocations while they own cwd, restore it on all exits, and release the guard only after cleanup. Dev calls may use the two slots. The scheduler limit is an upper bound, not proof of packaged parallel throughput.
10. Reuse existing telemetry hook/progress semantics. New records and errors use stable codes and no raw exception strings, credentials or external paths in UI-safe results. Result distinguishes render completion from quality review; include `reviewRequired: true`, never `qc_passed` or an originality flag. No IPC or platform side effects in this task.

# Constraints

You are not alone in the codebase: Codex owns integration and other isolated jobs may work on disjoint tasks. Do not revert or edit others' changes. Work only in the assigned worktree and six allowed files. Do not spawn native subagents; Agent Orchestrator owns delegation, models, retries and escalation. No commits, pushes, branches, releases, packaging, production actions, real account/media access, browser platform login/upload, cloud/paid-model calls, credential changes, package installation, new dependency links, destructive cleanup or unrelated refactors. Tests may create and remove their own verified temporary directories. Output/state files belong only to temporary test projects. Report unresolved behavior rather than inventing authority or weakening a guard.

# Acceptance criteria

- A three-version fixture renders all valid versions into separate output/state files; root and version project/manifest bytes remain unchanged.
- Globally no more than two injected render Promises are active; a failed version leaves the others able to complete, and same-batch concurrent instances cannot both render it.
- Abort reaches the Remotion cancel function and old callers without signal still work; cancelled active work does not release a slot until its Promise settles or become completed later.
- New instance reuses verified completed bytes without rendering, rechecks rights/source before reuse, rejects tampered output/config/timeline/source changes, and preserves unknown crash state without renderer calls.
- Expired/revoked source access or manual timeline edit stops before encoding; corrupt/symlink state and unsafe output locations are refused without overwrite.
- All tests are offline/synthetic. Passing local tests does not claim installed application, real recording quality, platform acceptance or R4 completion.

# Validation

Run from `app` in the assigned WSL worktree. Linux Vitest was already verified at `node_modules/vitest/vitest.mjs --version`; dependencies are preprovided.

```bash
node node_modules/vitest/vitest.mjs run tests/composition-render-batch.test.ts tests/render-video-headless-cancel.test.ts tests/remotion-render-cancel.test.ts --maxWorkers=2 --minWorkers=2
node node_modules/vitest/vitest.mjs run tests/composition-version-projects.test.ts tests/composition-source-resolver.test.ts tests/composition-timeline-builder.test.ts tests/export-run.test.ts tests/remotion-render-dimensions.test.ts --maxWorkers=2 --minWorkers=2
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

Do not run real Remotion/browser downloads, complete UI builds, package scripts, platform modules or network calls in the worker. Tests mock the renderer port and Remotion API, with real local version/state/output files. Codex will independently run Windows focused regression, typecheck, source build and three-version real synthetic encoding after review. Record RED and GREEN command results separately.

# Final report

List exact changed files, observable behavior, RED/GREEN/regression commands and exit results, what you could not execute, assumptions/deviations, unresolved risks and any required follow-up. Explain cancellation settlement and recovery behavior. State that UI, actual three-version encode, external GLM review, real media and platform acceptance are not proved by this job. Do not create a report file outside the six allowed paths; send the report through the job final response.
