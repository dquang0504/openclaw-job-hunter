from __future__ import annotations

import json
import os
import sys
from functools import lru_cache
from pathlib import Path

import fasttext


def openclaw_root() -> Path:
    env_root = os.environ.get("OPENCLAW_ROOT")
    if env_root:
        return Path(env_root).resolve()
    return Path(__file__).resolve().parents[2]


@lru_cache(maxsize=1)
def load_model():
    model_path = openclaw_root() / "execution" / "models" / "social-hiring.ftz"
    return fasttext.load_model(str(model_path))


def classify_text(text: str) -> dict:
    model = load_model()
    labels, scores = model.predict(text or "", k=2)
    normalized = [
        (label.replace("__label__", ""), float(score))
        for label, score in zip(labels, scores)
    ]

    top_label, top_score = normalized[0]
    runner_up_score = normalized[1][1] if len(normalized) > 1 else (1.0 - top_score)

    return {
        "label": top_label,
        "confidence": top_score,
        "margin": top_score - runner_up_score,
    }


def main() -> int:
    payload = json.loads(sys.stdin.read() or "{}")
    text = payload.get("text", "")
    sys.stdout.write(json.dumps(classify_text(text)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
