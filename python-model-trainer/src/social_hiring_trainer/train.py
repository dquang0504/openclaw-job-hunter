from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import fasttext

from .dataset import (
    LABEL_HIRING,
    LABEL_NON_HIRING,
    build_dataset,
    repo_root,
    split_dataset,
    summarize_samples,
    trainer_root,
    write_fasttext_dataset,
)


def evaluate(model: fasttext.FastText._FastText, samples):
    total = len(samples)
    correct = 0
    per_label = {
        LABEL_HIRING: {"tp": 0, "fp": 0, "fn": 0},
        LABEL_NON_HIRING: {"tp": 0, "fp": 0, "fn": 0},
    }

    rows = []
    for sample in samples:
        predicted_labels, scores = model.predict(sample.text, k=1)
        predicted = predicted_labels[0].replace("__label__", "")
        confidence = float(scores[0])

        rows.append(
            {
                "text": sample.text,
                "label": sample.label,
                "predicted": predicted,
                "confidence": round(confidence, 6),
                "source": sample.source,
            }
        )

        if predicted == sample.label:
            correct += 1
            per_label[sample.label]["tp"] += 1
        else:
            per_label[predicted]["fp"] += 1
            per_label[sample.label]["fn"] += 1

    metrics = {"accuracy": correct / total if total else 0.0, "total": total}
    for label, stats in per_label.items():
        precision = stats["tp"] / (stats["tp"] + stats["fp"]) if (stats["tp"] + stats["fp"]) else 0.0
        recall = stats["tp"] / (stats["tp"] + stats["fn"]) if (stats["tp"] + stats["fn"]) else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
        metrics[label] = {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "tp": stats["tp"],
            "fp": stats["fp"],
            "fn": stats["fn"],
        }

    return metrics, rows


def train_model(train_path: Path, valid_path: Path):
    return fasttext.train_supervised(
        input=str(train_path),
        autotuneValidationFile=str(valid_path),
        autotuneDuration=120,
        epoch=35,
        lr=0.6,
        wordNgrams=2,
        dim=64,
        minn=2,
        maxn=5,
        loss="ova",
        thread=1,
    )


def build_and_train(include_bootstrap_logs: bool = True) -> dict:
    root = repo_root()
    trainer = trainer_root()

    samples = build_dataset(include_bootstrap_logs=include_bootstrap_logs)
    train_samples, valid_samples = split_dataset(samples)

    dataset_dir = trainer / "build" / "datasets" / "social-hiring"
    report_dir = trainer / "build" / "reports"
    artifact_dir = trainer / "artifacts"
    model_dir = root / "execution" / "models"
    dataset_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    model_dir.mkdir(parents=True, exist_ok=True)

    train_path = dataset_dir / "train.txt"
    valid_path = dataset_dir / "valid.txt"
    write_fasttext_dataset(train_samples, train_path)
    write_fasttext_dataset(valid_samples, valid_path)

    model = train_model(train_path, valid_path)

    bin_path = artifact_dir / "social-hiring.bin"
    ftz_path = model_dir / "social-hiring.ftz"
    model.save_model(str(bin_path))
    model.quantize(input=str(train_path), retrain=True, cutoff=20000, qnorm=True, thread=1)
    model.save_model(str(ftz_path))

    metrics, predictions = evaluate(model, valid_samples)

    metadata = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "dataset": summarize_samples(samples),
        "train": summarize_samples(train_samples),
        "valid": summarize_samples(valid_samples),
        "metrics": metrics,
        "artifacts": {
            "bin": str(bin_path.relative_to(root)),
            "ftz": str(ftz_path.relative_to(root)),
        },
        "training": {
            "autotuneValidationFile": str(valid_path.relative_to(root)),
            "autotuneDurationSeconds": 120,
            "seed": 42,
        },
    }

    metadata_path = model_dir / "social-hiring.fasttext.json"
    report_path = report_dir / "social-hiring-metrics.json"
    predictions_path = report_dir / "social-hiring-validation-predictions.json"

    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    report_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    predictions_path.write_text(json.dumps(predictions, indent=2), encoding="utf-8")

    return {
        "metadata": metadata,
        "train_path": train_path,
        "valid_path": valid_path,
        "metadata_path": metadata_path,
        "report_path": report_path,
        "predictions_path": predictions_path,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Train the social hiring fastText model")
    parser.add_argument(
        "--skip-log-bootstrap",
        action="store_true",
        help="Train only from the tracked labeled dataset and ignore local log-derived bootstrap samples.",
    )
    args = parser.parse_args(argv)

    result = build_and_train(include_bootstrap_logs=not args.skip_log_bootstrap)
    metrics = result["metadata"]["metrics"]

    print("Training complete.")
    print(f"Accuracy: {metrics['accuracy']:.3f}")
    print(f"Hiring F1: {metrics[LABEL_HIRING]['f1']:.3f}")
    print(f"Non-hiring F1: {metrics[LABEL_NON_HIRING]['f1']:.3f}")
    print(f"Model metadata: {result['metadata_path']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
