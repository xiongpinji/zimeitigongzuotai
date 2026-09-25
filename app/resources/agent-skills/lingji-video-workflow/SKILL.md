---
name: lingji-video-workflow
version: 3
description: >-
  Use when helping with 灵机剪影/Lingji video production from a manuscript or
  project folder: open or create a Lingji project, move material into
  original.md, draft or revise script.md, then drive the running Lingji desktop
  app (TTS, subtitle analysis, covers, cards, export) through the bundled
  `lingji` CLI, and file-first edit project.json timeline overlays or Motion
  Card TSX files under ai-cards. Trigger for 从稿件到视频, 灵机剪影项目处理,
  改稿生成视频, 导出视频/导出 MP4, 调整视频卡片/字幕/动画, or continuing a
  Lingji project workflow.
---

# 灵机剪影稿件到视频工作流

## Overview

This skill turns a manuscript/material folder into a Lingji video and refines it. There are exactly two mechanisms — use the right one for each job, and do not invent a third:

1. **Generation / export → the `lingji` CLI.** Audio (TTS), subtitle analysis, cover/card/motion generation, and MP4 export run inside the running Lingji desktop app. You drive them by shelling out to the bundled CLI. The CLI connects to the live app and the result animates in the app window (progress bar, refreshed timeline). This works whether or not MCP tools are registered in your session — **never require MCP tools, and never tell the user to do these steps by hand.** (Media import has no CLI command yet — see `cli-workflow.md`.)
2. **Existing text / timeline files → file-first edits.** `original.md`, `script.md`, `project.json` timeline/overlays, and `ai-cards/<id>/motionCard.tsx` are edited directly on disk; the app file-watches and hot-reloads them.

Do not claim generation/export finished unless the CLI returned success (or you confirmed the output file). Do not fabricate generated media (audio/subtitles/cover images/MP4) by writing files by hand — only the CLI produces those.

## The `lingji` CLI

Invoke it through the injected entry path (works in dev and packaged builds):

```bash
node "$LINGJI_CLI" <command> [flags]
```

If `$LINGJI_CLI` is empty, fall back to the `lingji` command on PATH: `lingji <command>`. If neither resolves, the Lingji app is likely not running — ask the user to launch 灵机剪影, then retry. (The CLI talks to the running app over a local endpoint; a closed app means no endpoint.)

**Project targeting:** generation/export commands with no `--project` automatically target the project the app currently has open (its active project). Pass `--project <path>` only to target a different project.

**Commands:**

| Goal | Command |
| --- | --- |
| Show app's active project | `node "$LINGJI_CLI" project current` |
| List recent projects | `node "$LINGJI_CLI" project list` |
| Open / validate a project | `node "$LINGJI_CLI" project open <path>` |
| Generate口播音频 (TTS) | `node "$LINGJI_CLI" audio gen --wait` |
| Subtitle analysis + cards | `node "$LINGJI_CLI" subtitle analyze --wait` |
| Covers (prompt/image/both) | `node "$LINGJI_CLI" cover gen --wait` |
| Cards (list/show/update/regenerate/regen-media/convert/delete) | `node "$LINGJI_CLI" cards <action> [<cardId>] [--to <type>] [--wait]` |
| **Export MP4** | `node "$LINGJI_CLI" export --wait [--out <file>]` |
| Task status / wait / cancel | `node "$LINGJI_CLI" task status\|wait\|cancel <taskId>` |

Add `--json` to any command for machine-readable output. `--wait` polls the async task to terminal status and streams `[task] <status> <percent>% <phase>` to stderr.

Read `references/cli-workflow.md` before a full 稿件→视频 run, for connection details, the async fire-and-poll pattern, and import.

## Load References

Read only what the current step needs:

- `references/cli-workflow.md`: connecting to the app, project resolution, the CLI command set, async polling, media import.
- `references/script-editing.md`: before directly editing `original.md` or `script.md`.
- `references/video-editing.md`: before directly editing `project.json`, subtitles, overlays, or Motion Card TSX.

## Workflow

1. **Identify source and target.** Source can be a manuscript, material folder, audio/video file, URL, or an existing Lingji project. Run `node "$LINGJI_CLI" project current` to see what the app has open. If there is no project yet, open/create one in the app (or ask the user to) and re-check.

2. **Prepare the manuscript.** Put raw material into `original.md`; draft/rewrite the voiceover in `script.md` (file-first, see `script-editing.md`).

3. **Run generation through the CLI**, in order, each with `--wait`:
   - `audio gen` → `subtitle analyze` → `cover gen` (and `cards ...` as needed).
   - Poll to terminal status; on failure report the CLI's `error.code` / `error.message`.

4. **Refine the result.** For timing, placement, subtitle style, overlay motion, or Motion Card animation, edit `project.json` / `motionCard.tsx` file-first (see `video-editing.md`). For script issues, edit `script.md` then re-run `audio gen` / `subtitle analyze`.

5. **Export.** `node "$LINGJI_CLI" export --wait` (optionally `--out <file>`). Report the output path.

6. **Verify and report.** Report project path, what ran, the export output, and any remaining file-first edits. If the user says it is slow/stuck, read the latest auto-run JSONL log before advising (see `cli-workflow.md`).

## File-First Safety

When directly editing a Lingji project on disk:

- Create `<projectDir>/.lingji/edit-lock.json` before writes (`owner:"agent"`, `scope:"script"` for `original.md`/`script.md`, `scope:"video"` for `project.json`/Motion Card).
- Refresh `heartbeat` if editing takes more than ~15 seconds.
- Delete the lock when finished, even if a later step fails.
- After writing `project.json`, read `.lingji/edit-result.json` and repair until `ok:true`.

## Boundaries

- Generation/export → `lingji` CLI only (never MCP-tool-dependent, never manual). Text/timeline/source files → file-first. Import → in-app (no CLI command yet).
- Never hand-write generated media (`podcast-audio.*`, `podcast-subtitles*.srt`, `covers/`, `ai-cards/<id>/image.png`, MP4).
- Do not put API keys, tokens, or provider secrets into project files or telemetry.
- Do not modify `aiAnalysis` or `script` fields in `project.json` during video-domain edits.
- Do not change overlay `id` values unless the user explicitly requests a migration and you update all dependent paths.
