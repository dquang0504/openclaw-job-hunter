# OpenClaw Job Hunter

Job hunting automation for junior-oriented Golang roles with Telegram alerts.

The current production runtime is the Node.js pipeline in [`execution/job-search.js`](execution/job-search.js). It uses Playwright for browser automation and an OpenClaw-style orchestration layer in [`execution/openclaw`](execution/openclaw) for task ordering, state, policy, and telemetry.

## Current Runtime

Active runtime scrapers:
- Facebook groups
- X/Twitter
- Threads
- Indeed
- TopDev
- ITViec
- Vercel analytics
- Cloudflare check

Currently inactive in the runtime path:
- LinkedIn
- TopCV

Those files may still exist in the repo, but GitHub Actions and the OpenClaw runner do not call them right now.

## What It Does

- Searches for Golang/Go jobs oriented toward `intern`, `fresher`, `junior`, or `entry-level`
- Applies deterministic filters for freshness, location, and level
- Deduplicates against `logs/seen-jobs.json`
- Marks stale posts so old jobs do not keep resurfacing
- Optionally uses Groq AI to validate ambiguous posts
- Sends matching jobs and error screenshots to Telegram
- Runs on GitHub Actions every 4 hours

## Architecture

Runtime flow:
1. [`execution/job-search.js`](execution/job-search.js) bootstraps Playwright, cookies, env, reporter, and state
2. [`execution/openclaw/runner.js`](execution/openclaw/runner.js) orchestrates the run
3. [`execution/openclaw/tasks/index.js`](execution/openclaw/tasks/index.js) wraps scrapers into a common task contract
4. Scrapers in [`execution/scrapers`](execution/scrapers) collect raw candidates
5. Shared logic in [`execution/lib`](execution/lib) filters, dedups, validates, and reports
6. Run telemetry is written to `logs/openclaw-run-*.json`

OpenClaw here is not a separate browser engine. Playwright still drives the browser. OpenClaw is the orchestration layer on top of it.

## Requirements

- Node.js 22 recommended
- npm
- Playwright Chromium
- Telegram bot token and chat ID
- Valid cookies for the platforms you want to scrape

## Environment Variables

Use [`.env.example`](.env.example) as the template.

Required:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Optional:
- `GROQ_API_KEY`
- `CLOUDFLARE_API_KEY`
- `PROXY_SERVER`

If `GROQ_API_KEY` is missing, the pipeline falls back to deterministic regex validation.

## Cookie Files

Cookie files live in `.cookies/`.

Currently used by the runtime:
- `.cookies/cookies-twitter.json`
- `.cookies/cookies-facebook.json`
- `.cookies/cookies-threads.json`
- `.cookies/cookies-topdev.json`
- `.cookies/cookies-itviec.json`
- `.cookies/cookies-vercel.json`

Cookie files for inactive scrapers may still exist, but they are not required for the current GitHub Actions workflow.

See [`docs/03-extract-cookies.md`](docs/03-extract-cookies.md) for cookie extraction guidance.

## Local Setup

```bash
git clone <your-repo-url>
cd openclaw-job-hunter
npm install
npx playwright install chromium
cp .env.example .env
mkdir -p .cookies logs .tmp/screenshots
```

Then fill in `.env` and add the cookie files you actually need.

## Local Commands

Run the full pipeline:

```bash
npm run search
```

Dry run:

```bash
npm run search:dry
```

Single-platform example:

```bash
npm run search:twitter
```

Direct entrypoint examples:

```bash
node execution/job-search.js --platform=facebook
node execution/job-search.js --platform=threads
node execution/job-search.js --platform=twitter,indeed,topdev,itviec
node execution/job-search.js --dry-run --no-ai
```

## GitHub Actions

The main workflow is [`job-search.yml`](.github/workflows/job-search.yml).

Current cron behavior:
- runs every 4 hours
- splits the work into three matrix jobs:
  - `facebook`
  - `threads`
  - `others` (`twitter,indeed,vercel,cloudflare,topdev,itviec`)
- merges seen-job/cache artifacts in a follow-up job

Secrets currently used by the workflow:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `GROQ_API_KEY`
- `CLOUDFLARE_API_KEY`
- `COOKIES_TWITTER`
- `COOKIES_FACEBOOK`
- `COOKIES_THREADS`
- `COOKIES_TOPDEV`
- `COOKIES_ITVIEC`
- `COOKIES_VERCEL`

## Logs And State

Important runtime files:
- `logs/seen-jobs.json`: dedup and stale memory
- `logs/job-search-*.json`: raw collected job snapshots
- `logs/openclaw-run-*.json`: run-level task telemetry
- `logs/vercel-cache.json`: Vercel analytics cache
- `logs/cloudflare-cache.json`: Cloudflare cache
- `.tmp/screenshots/`: error/auth/debug screenshots

## Behavior Notes

- Freshness window is currently 7 days
- Mixed posts with both senior and junior roles are kept if they include at least one target junior role
- `Hanoi only` is filtered out, but mixed location posts such as `HCM + Hanoi` are allowed
- On auth/session failures, the scraper captures a screenshot, sends it to Telegram, and skips that platform instead of crashing the whole run

## Repo Layout

Key directories:
- [`execution`](execution): runtime code
- [`execution/openclaw`](execution/openclaw): orchestration layer
- [`execution/scrapers`](execution/scrapers): deterministic platform workers
- [`tools`](tools): support scripts
- [`testing`](testing): manual/debug test scripts
- [`docs`](docs): setup notes
- [`go-openclaw-automation`](go-openclaw-automation): separate Go subproject, not the active JS runtime

## Status

This repo is currently centered on the JS runtime with OpenClaw-style orchestration layered on top of Playwright. The Go subproject is still separate and is not what GitHub Actions executes today.
