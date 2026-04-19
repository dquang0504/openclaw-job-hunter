from __future__ import annotations

import json
import random
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


LABEL_HIRING = "hiring"
LABEL_NON_HIRING = "non_hiring"

STRONG_HIRING_REGEX = re.compile(
    r"\b(we('?| a)?re hiring|now hiring|hiring|apply now|send your cv|resume|"
    r"looking for someone|join our team|job opening|open position|vacancy|"
    r"remote role|oportunidad laboral|busco un/?a)\b",
    re.IGNORECASE,
)
ROLE_REGEX = re.compile(
    r"\b(golang|go developer|backend developer|backend engineer|go engineer|"
    r"typescript and golang|fastapi|laravel)\b",
    re.IGNORECASE,
)
STRONG_NON_HIRING_REGEX = re.compile(
    r"\b(my pick|recommendations|advice|roadmap|tutorial|course|resource|study|"
    r"showcase|side project|open to work|looking for (a )?job|hire me|freelance|"
    r"portfolio|built|podcast|bigdata|datascience|machinelearning|book|"
    r"serverless|azure functions|quantum|design patterns|day \d+ of backend|"
    r"rest api in golang beat that|mantap pakai golang|starting golang)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Sample:
    text: str
    label: str
    source: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def trainer_root() -> Path:
    return Path(__file__).resolve().parents[2]


def normalize_text(text: str) -> str:
    cleaned = " ".join((text or "").split())
    return cleaned.strip()


def load_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    if not path.exists():
        return rows

    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def load_manual_labels() -> list[Sample]:
    dataset_path = trainer_root() / "data" / "labeled_samples.jsonl"
    samples: list[Sample] = []
    for row in load_jsonl(dataset_path):
        text = normalize_text(row.get("text", ""))
        label = row.get("label", "").strip()
        source = row.get("source", "manual").strip() or "manual"
        if not text or label not in {LABEL_HIRING, LABEL_NON_HIRING}:
            continue
        samples.append(Sample(text=text, label=label, source=source))
    return samples


def bootstrap_from_threads_log() -> list[Sample]:
    log_path = repo_root() / "logs" / "test-threads-results.json"
    if not log_path.exists():
        return []

    with log_path.open("r", encoding="utf-8") as handle:
        items = json.load(handle)

    samples: list[Sample] = []
    for item in items:
        text = normalize_text(item.get("description") or item.get("preview") or "")
        if not text:
            continue

        if STRONG_HIRING_REGEX.search(text) and ROLE_REGEX.search(text):
            samples.append(Sample(text=text, label=LABEL_HIRING, source="threads_log_bootstrap"))
            continue

        if STRONG_NON_HIRING_REGEX.search(text):
            samples.append(Sample(text=text, label=LABEL_NON_HIRING, source="threads_log_bootstrap"))

    return samples


def dedupe_samples(samples: Iterable[Sample]) -> list[Sample]:
    deduped: dict[tuple[str, str], Sample] = {}
    for sample in samples:
        text = normalize_text(sample.text)
        if not text:
            continue
        key = (sample.label, text.casefold())
        deduped.setdefault(key, Sample(text=text, label=sample.label, source=sample.source))
    return list(deduped.values())


def build_dataset(include_bootstrap_logs: bool = True) -> list[Sample]:
    samples = load_manual_labels()
    if include_bootstrap_logs:
        samples.extend(bootstrap_from_threads_log())
    return dedupe_samples(samples)


def split_dataset(samples: list[Sample], seed: int = 42, valid_ratio: float = 0.2) -> tuple[list[Sample], list[Sample]]:
    grouped: dict[str, list[Sample]] = {
        LABEL_HIRING: [],
        LABEL_NON_HIRING: [],
    }
    for sample in samples:
        grouped[sample.label].append(sample)

    rng = random.Random(seed)
    train: list[Sample] = []
    valid: list[Sample] = []

    for label, label_samples in grouped.items():
        rng.shuffle(label_samples)
        valid_size = max(1, round(len(label_samples) * valid_ratio))
        if len(label_samples) <= 3:
            valid_size = 1
        valid.extend(label_samples[:valid_size])
        train.extend(label_samples[valid_size:])

    rng.shuffle(train)
    rng.shuffle(valid)
    return train, valid


def to_fasttext_line(sample: Sample) -> str:
    return f"__label__{sample.label} {sample.text}"


def write_fasttext_dataset(samples: list[Sample], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for sample in samples:
            handle.write(to_fasttext_line(sample))
            handle.write("\n")


def summarize_samples(samples: list[Sample]) -> dict:
    label_counts = Counter(sample.label for sample in samples)
    source_counts = Counter(sample.source for sample in samples)
    return {
        "total_samples": len(samples),
        "label_counts": dict(label_counts),
        "source_counts": dict(source_counts),
    }
