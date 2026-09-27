# Objective

Implement `buildCompositionTimeline(plan, sources): TimelineData` so an R4 `original-audio` plan and its main-process verified source snapshot become one editable Lingji timeline. Do not persist files or modify the existing project.

# Why

R4 currently verifies reviewed clips and B-roll rights but cannot place them on the editor timeline. `VideoOverlay.tsx` mutes visual video, so original sound must be a separate audio overlay with exactly the same clip path, timeline interval and source trim. B-roll must cover only the visual layer.

# Scope

Own only `app/electron/composition/timeline-builder.ts` and `app/tests/composition-timeline-builder.test.ts`. Read but do not edit other files. No package, real account, network media, publication, narration synthesis, project persistence, or platform originality claim. This job may run alongside another job that owns only `version-projects.ts` and its test.

# Files to inspect

- `AGENTS.md` and `app/AGENTS.md`: repository limits, especially no real account or release work.
- `docs/superpowers/plans/2026-09-28-r4-multi-version-composition.md`, task 4, and `docs/superpowers/plans/2026-09-28-r4-task4-orchestration.md`: accepted behavior and this bounded execution split.
- `app/electron/composition/source-resolver.ts`: exact `ResolvedCompositionSources`, segment clip and visualLayer fields; this is the sole media authority.
- `app/src/types/production-contracts.ts`: `CompositionPlanV1`, editorial, segment, voiceover and aspect fields.
- `app/src/types.ts`: `TimelineData`, `OverlayItem`, `createDefaultTimeline`, `createVisualTrack`, `createAudioOverlayTrack`, `createDefaultAudioOverlayData`.
- `app/src/lib/text-templates.ts`: `createDefaultTextData` for editable opening and ending.
- `app/src/lib/timeline-tracks.ts`, `app/src/remotion/timeline-to-sequences.ts`, `app/src/remotion/overlays/VideoOverlay.tsx`, `app/src/remotion/overlays/AudioOverlay.tsx`: track order, mute behavior, trim and rendering contracts.
- `app/tests/composition-source-resolver.test.ts`: source fixture shape and review provenance.

# Implementation guidance

1. Write failing tests first for same-source video/audio timing, B-roll z-order and continuous audio, editable opening/ending text, output dimensions, and rejected mismatch/unsupported voiceover. Run the focused test and record the expected failure before implementation.
2. Export `buildCompositionTimeline(plan: CompositionPlanV1, sources: ResolvedCompositionSources): TimelineData` and a typed error with stable code for invalid source/plan and unsupported voiceover. Require `plan.editorial`, `sources.planId === plan.id`, at least one segment, and an exact one-to-one match of segment IDs, order, source absolute in/out against resolved clip, plus valid positive clip and B-roll ranges. Reject `narration` and `mixed` until a verified narration asset exists; never silently label them as original audio.
3. Start from `createDefaultTimeline()`. Map aspect ratios to 16:9=1920x1080, 9:16=1080x1920, 1:1=1080x1080, 4:3=1440x1080, 3:4=1080x1440. Use deterministic IDs and cumulative segment start times, with `visual-1` for reviewed video, `visual-2` for B-roll, `visual-3` for text, and `audio-overlay-1` for original sound. Use each reviewed clip's `path`, `sourceInMs`, `outputDurationMs` for matching video/audio trim and source duration. Main segment duration is `sourceOutMs-sourceInMs`; source video is muted by the existing renderer while its separate audio overlay carries sound.
4. A visualLayer starts at main segment start plus `startAtMs`, uses `durationMs`, `path`, and `sourceInMs` for video; an image has no video trim. It must fit within both the plan segment and the source asset as far as supplied snapshot fields allow. Do not shorten or mute the original audio overlay.
5. Add editable `text` overlays using `createDefaultTextData` with `openingClaim` at timeline start and `endingMessage` ending at timeline end. Keep them on the highest visual track. Keep the input objects unmodified, and do not invoke filesystem/network APIs.
6. Existing render planning must expose the visual layering and one original audio item per reviewed segment. If an essential media contract conflicts with these instructions, stop and ask via the orchestrator question channel.

# Constraints

Do not commit, push, release, package, deploy, modify credentials, add dependencies, remove files, perform destructive cleanup, or edit outside the two owned paths. Do not spawn native subagents or any nested agent; Agent Orchestrator owns delegation, model choice and retry. No real accounts or platform publication. Keep tests synthetic and offline.

# Acceptance criteria

- A 300 ms source trim on a reviewed MP4 appears as `videoData.trimStartMs=300` and `audioData.trimStartMs=300` at identical `startMs` and duration.
- A B-roll starting 200 ms into a segment has higher visual track order while the original audio item retains the full segment duration.
- Text overlays contain editable `TextOverlayData.content` matching the opening/ending claims; a reopened timeline can read those plain JSON fields.
- Invalid segment mapping, out-of-bounds B-roll and unsupported voiceover fail explicitly. No input mutation, no file write and no claimed originality verdict.

# Validation

From `app`: `npx vitest run tests/composition-timeline-builder.test.ts`; then `npx tsc --noEmit`. The first focused run must fail before implementation. Do not run packaging or real-media/platform tests. Codex will run broader checks and synthetic Remotion render after integration.

# Final report

Report exact changed files, observable behavior, failed-first test evidence, final command exit results, deviations, assumptions, and remaining risks. Name any instruction that could not be followed instead of silently substituting another approach.
