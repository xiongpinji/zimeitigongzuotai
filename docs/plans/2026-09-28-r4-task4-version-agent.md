# Objective

Persist three independent, reopenable R4 version projects under the current Lingji project without changing its root `project.json`, preserving each timeline and verified source hashes.

# Why

R4 plan proposals and reviewed-media resolution exist, but a version cannot yet survive restart as a separate editable project. The stage must resist path traversal, accidental overwrite, interrupted writes, and changed media provenance before later rendering.

# Scope

Own only `app/electron/composition/version-projects.ts` and `app/tests/composition-version-projects.test.ts`. Read but do not edit other files. Another independent job owns `timeline-builder.ts` and its test. No UI, IPC, renderer, render scheduling, account connection, packaging, publication, or platform originality claim.

# Files to inspect

- `AGENTS.md`, `app/AGENTS.md`: repository instructions and release limits.
- `docs/superpowers/plans/2026-09-28-r4-multi-version-composition.md`, task 4, and `docs/superpowers/plans/2026-09-28-r4-task4-orchestration.md`: accepted path and recovery behavior.
- `app/electron/composition/source-resolver.ts`: `ResolvedCompositionSources`, receipt IDs, clip and asset hashes, rights context.
- `app/src/types/production-contracts.ts`: `CompositionPlanV1` ID and editorial fields.
- `app/src/types.ts`: `TimelineData` format; no import from the concurrently written timeline builder.
- `app/src/lib/project-persistence.ts`: `ProjectData` and `createDefaultProjectData` for an ordinary editable Lingji `project.json`.
- `app/electron/project-file.ts`: existing project file save/load and atomic write pattern; do not write to the root project.
- `app/tests/project-file.test.ts`, `app/tests/composition-source-resolver.test.ts`: temp-project and provenance test patterns.

# Implementation guidance

1. Write failing tests first for three distinct subprojects, root `project.json` byte preservation, reopened timeline and source hashes, retry after partial completion, same-name/different-content conflict, invalid IDs, corrupt existing version and directory symlinks. Run the focused test and record the expected failure.
2. Export `persistCompositionVersions(input)` accepting `{ projectDir: string; batchId: string; versions: Array<{ plan: CompositionPlanV1; timeline: TimelineData; sources: ResolvedCompositionSources }> }`, and `readCompositionVersion(input)` accepting `{ projectDir: string; batchId: string; planId: string }`. Return each version's resolved project directory and manifest. Require at least three distinct plans, `sources.planId === plan.id`, a nonempty timeline, and safe IDs consisting only of ASCII letters, digits, `_` and `-` (initial character alphanumeric, maximum 128); reject path separators, dot components and Windows device names.
3. Resolve the existing project directory with `realpath`; require an existing root `project.json`. Every created or existing `compositions`/batch/plan path component must be a real directory, never a symlink. Destination must be `realProjectDir/compositions/<batchId>/<planId>/`. Do not accept a renderer-supplied output path. Reads must reject symlinked version dirs/files and paths escaping this root.
4. For each version, prepare a sibling staging directory within its batch, write a `ProjectData` v1 `project.json` with the supplied timeline using `createDefaultProjectData`, and write a JSON `composition-manifest.json` with schema version, batch/plan IDs, full plan and resolved source snapshot (including receipt IDs and source/output/asset hashes), plus SHA-256 of the serialized timeline and snapshot. Publish a complete version by renaming its staging directory to the final name. Keep incomplete staging dirs out of reads/listing. Clean up only the staging dir created by this invocation after verifying its resolved path lies within the batch; never recursively delete a target or user's existing data.
5. On retry, validate an existing version before deciding idempotency. Return it unchanged only when its stored plan, timeline and source snapshot match the requested content and hashes. Reject corrupt or differing content with a typed conflict/corruption error; never overwrite it. If a batch fails after one version was committed, a retry with the same content may finish the missing versions. Do not claim batch-wide atomicity.
6. Keep the root project's `project.json` bytes unchanged. `readCompositionVersion` is read-only and validates stored hashes before returning the editable `ProjectData` and provenance manifest. Do not use `loadProjectFile` on an unverified or incomplete directory because it may create/migrate files. If atomic no-replace behavior differs by OS, treat an existing destination as a conflict and never replace it.

# Constraints

Do not commit, push, release, package, deploy, change credentials, install dependencies, edit outside the two owned paths, or do destructive cleanup. Do not spawn native subagents or any nested agent; Agent Orchestrator owns delegation, routing and retry. Never use real platform accounts or publish. Use OS temp directories in tests and remove only test-owned temp trees.

# Acceptance criteria

- Three plans produce three separate valid Lingji `project.json` files and three provenance manifests inside the specified `compositions` tree; root `project.json` bytes remain identical.
- Reading each version returns the same timeline and reviewed clip/asset hashes; manifest corruption or file mutation is detected.
- Repeating identical input is idempotent; same IDs with changed timeline, plan or source hashes produce an explicit conflict and leave prior bytes intact.
- Traversal, device-name, symlink and malformed directory inputs fail before any write outside the project. A partial batch can resume without overwriting completed versions.

# Validation

From `app`: `npx vitest run tests/composition-version-projects.test.ts`; then `npx tsc --noEmit`. The first focused run must fail before implementation. Do not run packaging, real-media or platform tests. Codex will run broader checks after integration.

# Final report

Report exact changed files, failed-first test evidence, final command exit results, behavior, assumptions, deviations, and remaining risks. Identify any instruction that could not be followed rather than silently changing scope.
