# Python Model Trainer

This workspace trains a local `fastText` classifier for social hiring posts.

The current target is binary classification:

- `hiring`
- `non_hiring`

The trainer uses:

- tracked labeled samples in `data/labeled_samples.jsonl`
- optional conservative bootstrap labels from `../logs/test-threads-results.json` when that file exists locally

## Setup

```bash
cd python-model-trainer
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m social_hiring_trainer.cli train
```

## Outputs

- `build/datasets/social-hiring/train.txt`
- `build/datasets/social-hiring/valid.txt`
- `build/reports/social-hiring-metrics.json`
- `artifacts/social-hiring.bin`
- `../execution/models/social-hiring.ftz`
- `../execution/models/social-hiring.fasttext.json`

## Notes

- The model is intentionally small and CPU-friendly so it can later run inside GitHub Actions cron.
- The dataset is bootstrap quality, not gold quality. Add more labeled samples over time instead of overfitting regex into the trainer.
