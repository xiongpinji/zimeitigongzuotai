# Multi TTS Provider And Voice Clone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable TTS Providers and reusable cloned voice presets, with Xiaomi MiMo voice-clone TTS fully usable in the one-click workflow.

**Architecture:** Extend `AISettings` with provider and voice preset arrays while keeping deprecated MiniMax fields for compatibility. Route `generate-tts` through a provider dispatcher in Electron, then keep writing standard podcast audio and SRT files so downstream workflow code remains stable.

**Tech Stack:** React, Zustand, Electron IPC, TypeScript, MiniMax T2A v2, Xiaomi MiMo `/v1/chat/completions` audio output.

---

### Task 1: Types And Migration Helpers

**Files:**
- Modify: `src/types/ai.ts`
- Modify: `src/store/ai.ts`
- Create: `src/lib/tts-settings.ts`

- [ ] Add `TTSProviderType`, `TTSProvider`, and `TTSVoicePreset` to `src/types/ai.ts`.
- [ ] Add `ttsProviders`, `defaultTtsProviderId`, `defaultTtsVoiceId`, and `ttsVoices` to `AISettings`.
- [ ] Implement `normalizeTTSSettings(settings)` in `src/lib/tts-settings.ts`.
- [ ] Make `buildDefaultAISettings()` include empty TTS arrays and null defaults.
- [ ] Update `loadAISettings()` merge paths so old MiniMax fields produce one default MiniMax provider and one default system voice.

### Task 2: Provider Implementations

**Files:**
- Modify: `src/lib/minimax-tts.ts`
- Create: `src/lib/xiaomi-mimo-tts.ts`
- Create: `electron/tts-provider-runner.ts`
- Modify: `electron/main.ts`

- [ ] Extract MiniMax generation into a runner that returns `{ audioBuffer, audioExtension, subtitleText, durationMs }`.
- [ ] Implement MiMo request builder and response decoder.
- [ ] Implement reference audio validation: file exists, extension is `.mp3` or `.wav`, Base64 payload is under MiMo documented limit.
- [ ] Update `generate-tts` IPC to accept new `{ provider, voice }` args and old MiniMax args.
- [ ] Preserve progress events and auto-run telemetry.

### Task 3: Renderer IPC Types

**Files:**
- Modify: `electron/preload.ts`
- Modify: `src/lib/electron-api.ts`

- [ ] Update `generateTTS` argument type to accept provider and voice objects.
- [ ] Keep old fields optional for migration compatibility.
- [ ] Ensure returned `{ audioPath, srtPath, durationMs }` is unchanged.

### Task 4: TTS Settings UI

**Files:**
- Modify: `src/components/settings/TTSConfigTab.tsx`
- Create: `src/components/settings/TTSProviderListSection.tsx`
- Create: `src/components/settings/TTSVoiceListSection.tsx`
- Reuse: `src/components/settings/ImageProviderListSection.module.css`

- [ ] Replace the single MiniMax form with Provider list and Voice list sections.
- [ ] Add Provider dialog with type, name, baseUrl, apiKey, models, and default checkbox.
- [ ] Add Voice dialog for system voice and cloned voice.
- [ ] For cloned voice, use a file path input first and optionally a native file selector if existing API supports audio selection.
- [ ] Save through existing `saveAISettings()` without dropping unrelated settings.

### Task 5: Workflow Integration

**Files:**
- Modify: `src/hooks/useAIVideoWorkflow.ts`
- Modify: `src/components/script/AutoModeSection.tsx`
- Modify: `src/components/AutoRunLauncher.tsx`
- Modify: `src/pages/Setup.tsx`

- [ ] Resolve effective default TTS provider and voice with `normalizeTTSSettings()`.
- [ ] Replace direct `settings.minimax*` generation args with `{ provider, voice }`.
- [ ] Keep Auto Mode voice override compatible by mapping chosen voice id onto the default MiniMax voice where applicable.
- [ ] Update missing-config error text to mention TTS Provider and default voice.

### Task 6: Tests And Verification

**Files:**
- Create or modify focused tests under `src/lib/*.test.ts`

- [ ] Add tests for old MiniMax settings migration.
- [ ] Add tests for MiMo request/response decode with a small fake response.
- [ ] Run `npm test -- --run`.
- [ ] Run `npm run build`.
- [ ] Run a real MiMo clone smoke test using `/Users/yoqu/Downloads/最新宣传视频.mp3` and verify output with `ffprobe`.
- [ ] Start the dev app and browser-check the Settings TTS tab renders.
