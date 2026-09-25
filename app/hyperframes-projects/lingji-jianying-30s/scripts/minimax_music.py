#!/usr/bin/env python3
"""Generate instrumental BGM with MiniMax Music API."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path


def load_api_key(config_path: Path | None) -> str:
    env_key = os.environ.get("MINIMAX_API_KEY")
    if env_key:
        return env_key
    if config_path and config_path.exists():
        data = json.loads(config_path.read_text(encoding="utf-8"))
        api_key = data.get("api_key")
        if isinstance(api_key, str) and api_key:
            return api_key
    raise RuntimeError("Missing MiniMax API key")


def request_music(api_key: str, prompt: str) -> dict:
    payload = {
        "model": "music-2.6",
        "prompt": prompt,
        "is_instrumental": True,
        "output_format": "hex",
        "aigc_watermark": False,
        "audio_setting": {
            "sample_rate": 44100,
            "bitrate": 256000,
            "format": "mp3",
        },
    }
    url = "https://api.minimax.io/v1/music_generation"
    body = json.dumps(payload, ensure_ascii=False)
    if shutil.which("curl"):
        completed = subprocess.run(
            [
                "curl",
                "-sS",
                "--fail-with-body",
                "--request",
                "POST",
                url,
                "--header",
                f"Authorization: Bearer {api_key}",
                "--header",
                "Content-Type: application/json",
                "--data",
                body,
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=240,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise RuntimeError(f"curl music request failed: {detail}")
        return json.loads(completed.stdout)

    request = urllib.request.Request(
        url,
        data=body.encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=240) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--config",
        default=str(Path.home() / ".claude/skills/minimax-tts/config.json"),
    )
    args = parser.parse_args()

    api_key = load_api_key(Path(args.config).expanduser())
    result = request_music(api_key, args.prompt)
    status = result.get("base_resp", {}).get("status_code")
    if status != 0:
        raise RuntimeError(json.dumps(result, ensure_ascii=False)[:1200])

    audio_hex = result.get("data", {}).get("audio")
    if not isinstance(audio_hex, str) or not audio_hex:
        raise RuntimeError(f"No audio hex in response: {json.dumps(result, ensure_ascii=False)[:1200]}")

    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(bytes.fromhex(audio_hex))
    print(json.dumps({"file": str(output), "extra_info": result.get("extra_info", {})}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)
