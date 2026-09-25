# Video Editing Reference

Use this reference before directly editing Lingji video timeline data or Motion Card source.

## Editable Files

- `<projectDir>/project.json` → only the `timeline` section.
- `<projectDir>/ai-cards/<overlayId>/motionCard.tsx` → Motion Card Remotion source.

Do not edit generated media artifacts: `podcast-audio.mp3`, `podcast-subtitles*.srt`, `covers/`, `ai-cards/<id>/image.png`, or rendered MP4 files.

## Lock And Result Protocol

Before editing, create `<projectDir>/.lingji/edit-lock.json`:

```json
{
  "owner": "codex",
  "scope": "video",
  "startedAt": 1718260000000,
  "heartbeat": 1718260000000,
  "ttlMs": 30000
}
```

Use current epoch milliseconds. Refresh `heartbeat` if work exceeds about 15 seconds. Delete the lock after writing.

After editing `project.json`, read `<projectDir>/.lingji/edit-result.json`. If `ok:false`, fix the listed `errors[].field` / `errors[].message`, rewrite `project.json`, and check again until `ok:true`. Editing `motionCard.tsx` does not produce this result file.

## Project JSON Boundaries

Only edit `timeline`. Do not hand-edit top-level `aiAnalysis` or `script` while doing video-domain work.

Common editable fields in `timeline.overlays[]`:

- `startMs`, `durationMs`: milliseconds; `startMs >= 0`, `durationMs > 0`.
- `position`: `{ "x": number, "y": number, "width": number, "height": number }` in canvas pixels.
- `motion`: overlay enter/exit/loop animation.
- `textData`: text content, font, color, shadow, stroke, opacity, rotation, and text animation for text overlays.
- `audioData`: volume, fades, trim start, source duration, mute state for audio overlays.

Do not change `id` unless explicitly migrating dependencies; it maps to `ai-cards/<id>/`.

## Animation Values

`motion.enter`:

- `none`
- `fadeIn`
- `slideInLeft`
- `slideInRight`
- `slideInUp`
- `slideInDown`
- `scaleIn`
- `bounceIn`

`motion.exit`:

- `none`
- `fadeOut`
- `slideOutLeft`
- `slideOutRight`
- `slideOutUp`
- `slideOutDown`
- `scaleOut`
- `bounceOut`

Overlay `motion.loop`:

- `none`
- `pulse`
- `float`
- `flicker`

`textData.animation.loop` also allows `typewriter`.

## Subtitle Style

Edit `timeline.subtitle` for global voiceover subtitle styling:

- `fontSize`
- `color`
- `position`: `top`, `bottom`, or `center`
- `highlightEnabled`
- `highlightBackgroundColor`
- `highlightTextColor`
- `highlightPaddingX`
- `highlightPaddingY`
- `highlightRadius`
- `highlightAnimation`: `pop`, `wipe`, or `none`
- `maxCharsPerEntry`
- `autoResegment`

## Motion Card TSX

Edit `<projectDir>/ai-cards/<overlayId>/motionCard.tsx` directly.

Hard constraints:

- No Markdown code fence; the file is raw TSX.
- Export a default React function component.
- Render real JSX; do not return `null`.
- Prefer Remotion frame-driven animation with `useCurrentFrame()`, `useVideoConfig()`, `interpolate`, `spring`, `AbsoluteFill`, and `Sequence`.
- Keep the component pure: no side effects, no external network requests, no timers.

### Images inside a Motion Card

Reference project images through the injected global `cardAsset(relativePath)` — never with absolute paths, `staticFile()` on an absolute path, or large inline `base64` data URIs (these break export: `staticFile() does not support absolute paths`, or multi-MB cards that crash the headless render with out-of-memory).

- Put the image file under the project, e.g. `<projectDir>/assets/<name>.png`, then reference it with a **project-relative** path.
- Wrap it with `cardAsset`, which resolves to `file://` in preview and to the materialized bundle path on export:

```tsx
import { AbsoluteFill, Img, useCurrentFrame } from 'remotion';

export default function Card() {
  return (
    <AbsoluteFill>
      <Img src={cardAsset('assets/codex-visuals/eu-factory.png')} style={{ width: '100%' }} />
    </AbsoluteFill>
  );
}
```

- `cardAsset` is provided by the host runtime; do not import or redefine it.
- The referenced file must already exist on disk under the project before export.
- Tiny inline SVG/icon data URIs (< ~8KB) are tolerated, but prefer `cardAsset` for any real photo/illustration.

