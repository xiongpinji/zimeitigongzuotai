#!/usr/bin/env python3
"""Generate narration with MiniMax T2A using the current official endpoint."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path


def load_config(path: Path) -> dict:
    config: dict = {}
    if path.exists():
        config = json.loads(path.read_text(encoding="utf-8"))
    api_key = os.environ.get("MINIMAX_API_KEY") or config.get("api_key")
    if not api_key:
        raise RuntimeError("Missing MiniMax API key")
    config["api_key"] = api_key
    return config


def request_tts(text: str, config: dict, speed: float) -> dict:
    payload = {
        "model": config.get("model", "speech-2.8-hd"),
        "text": text,
        "stream": False,
        "voice_setting": {
            "voice_id": config.get("voice_id", "male-qn-qingse"),
            "speed": speed,
            "vol": float(config.get("vol", 1.0)),
            "pitch": int(config.get("pitch", 0)),
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": "mp3",
            "channel": 1,
        },
        "subtitle_enable": False,
        "output_format": "hex",
        "aigc_watermark": False,
        "language_boost": "Chinese",
    }
    url = "https://api.minimax.io/v1/t2a_v2"
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
                f"Authorization: Bearer {config['api_key']}",
                "--header",
                "Content-Type: application/json",
                "--data",
                body,
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=180,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise RuntimeError(f"curl TTS request failed: {detail}")
        return json.loads(completed.stdout)

    request = urllib.request.Request(
        url,
        data=body.encode("utf-8"),
        headers={
            "Authorization": f"Bearer {config['api_key']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--speed", type=float, default=1.08)
    parser.add_argument(
        "--config",
        default=str(Path.home() / ".claude/skills/minimax-tts/config.json"),
    )
    args = parser.parse_args()

    text = Path(args.file).read_text(encoding="utf-8").strip()
    config = load_config(Path(args.config).expanduser())
    result = request_tts(text, config, args.speed)
    status = result.get("base_resp", {}).get("status_code")
    if status != 0:
        raise RuntimeError(json.dumps(result, ensure_ascii=False)[:1200])

    audio_hex = result.get("data", {}).get("audio")
    if not isinstance(audio_hex, str) or not audio_hex:
        raise RuntimeError(f"No audio hex in response: {json.dumps(result, ensure_ascii=False)[:1200]}")

    output = Path(args.output).expanduser().resolve()
    output.write_bytes(bytes.fromhex(audio_hex))
    print(json.dumps({"file": str(output), "extra_info": result.get("extra_info", {})}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)
