"""Persistent Kokoro ONNX worker used only by the feasibility benchmark.

Protocol: one JSON object per stdin line and one JSON object per stdout line.
The model remains loaded until stdin closes or a shutdown request is received.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--voices", required=True)
    parser.add_argument("--voice", default="af_sarah")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--language", default="en-us")
    parser.add_argument("--threads", type=int, default=8)
    args = parser.parse_args()

    os.environ.setdefault("OMP_NUM_THREADS", str(args.threads))
    os.environ.setdefault("OMP_WAIT_POLICY", "PASSIVE")

    started = time.perf_counter()
    try:
        from kokoro_onnx import Kokoro

        engine = Kokoro(args.model, args.voices)
    except Exception as exc:  # pragma: no cover - requires real model setup
        emit({"type": "error", "stage": "startup", "error": repr(exc)})
        return 2

    emit(
        {
            "type": "ready",
            "startupMs": (time.perf_counter() - started) * 1000,
            "pid": os.getpid(),
        }
    )

    for raw_line in sys.stdin:
        try:
            request = json.loads(raw_line)
            if request.get("type") == "shutdown":
                emit({"type": "shutdown", "ok": True})
                return 0
            text = str(request["text"])
            request_id = str(request.get("id", ""))
            call_started = time.perf_counter()
            samples, sample_rate = engine.create(
                text,
                voice=request.get("voice", args.voice),
                speed=float(request.get("speed", args.speed)),
                lang=request.get("language", args.language),
            )
            elapsed_ms = (time.perf_counter() - call_started) * 1000
            sample_count = int(len(samples))
            emit(
                {
                    "type": "result",
                    "id": request_id,
                    "generationMs": elapsed_ms,
                    "sampleRate": int(sample_rate),
                    "sampleCount": sample_count,
                    "audioSeconds": sample_count / float(sample_rate),
                }
            )
        except Exception as exc:  # pragma: no cover - requires real model setup
            emit(
                {
                    "type": "error",
                    "id": str(request.get("id", "")) if "request" in locals() else "",
                    "stage": "synthesis",
                    "error": repr(exc),
                }
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

