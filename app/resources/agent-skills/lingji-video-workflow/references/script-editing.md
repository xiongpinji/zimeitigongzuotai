# Script Editing Reference

Use this reference before directly editing a Lingji project’s `original.md` or `script.md`.

## Scope

Editable files:

- `<projectDir>/original.md`: raw source material.
- `<projectDir>/script.md`: final voiceover script used for TTS/subtitles.

Do not edit video timeline, cards, audio, subtitles, covers, or rendered media in this mode.

## Lock Protocol

Before writing either Markdown file, create `<projectDir>/.lingji/edit-lock.json`:

```json
{
  "owner": "codex",
  "scope": "script",
  "startedAt": 1718260000000,
  "heartbeat": 1718260000000,
  "ttlMs": 30000
}
```

Use current epoch milliseconds for `startedAt` and `heartbeat`. If editing takes more than about 15 seconds, rewrite the file with a fresh `heartbeat`; keep the interval below `ttlMs`.

Delete the lock after writing. Script edits do not produce `.lingji/edit-result.json`.

## Save Behavior

- Saving `script.md` externally reloads the script workspace and creates a version history entry with source `external`.
- Saving `original.md` externally reloads the corresponding workspace tab.
- If audio/subtitles should reflect a changed script, rerun generation via the CLI: `node "$LINGJI_CLI" audio gen --wait` then `node "$LINGJI_CLI" subtitle analyze --wait` (see `cli-workflow.md`).

## Direct Edit Steps

1. Confirm `<projectDir>` contains the Lingji project files.
2. Write the script lock.
3. Read the target Markdown file.
4. Apply the requested rewrite or polish.
5. Write the complete updated Markdown file.
6. Delete the lock.
7. Report that downstream generated artifacts may need regeneration.

