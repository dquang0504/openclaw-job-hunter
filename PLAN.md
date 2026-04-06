# OpenClaw JS Integration Plan

## Goal
Turn the current Node.js scraper into an OpenClaw-style system where:
- Playwright remains the browser execution layer.
- OpenClaw becomes the orchestration, state, policy, retry, and observability layer.
- Scrapers become narrower deterministic workers instead of owning business rules and run control.

This is not a rewrite to "replace Playwright".
It is a refactor to move orchestration out of `execution/job-search.js` and out of individual scrapers.

## Current Reality
The current runtime path is:
1. GitHub Actions / systemd runs `node execution/job-search.js`
2. `execution/job-search.js` launches Playwright
3. `execution/job-search.js` directly calls each scraper
4. shared filters + dedup + AI validation + Telegram run in the same process

Current strengths:
- The project works end-to-end today
- Playwright scraping is already usable
- Shared filters/dedup are starting to converge

Current structural problems:
- `execution/job-search.js` is both bootstrap and orchestration brain
- stop conditions and business rules are split across scrapers and shared libs
- retry, rate-limit handling, stale handling, and scan-depth control are platform-specific and hard to reason about
- state is file-based and partially centralized, but not modeled as a first-class orchestration concern
- observability is log-oriented, not task/run-oriented

## What "Use OpenClaw" Means In This Repo
OpenClaw should be added as the deterministic coordination layer with these responsibilities:
- run planning
- task sequencing
- state management
- retry policy
- per-platform scan policy
- stop conditions
- cooldown and backoff
- standardized result contracts
- structured run logs

It should not own:
- DOM scraping details
- browser selector logic
- direct HTML extraction logic

Those remain in `execution/scrapers/*.js`.

## Proposed Target Architecture

### 1. Thin Entry Point
Keep:
- `execution/job-search.js`

Change:
- reduce it to bootstrap only
- load config
- initialize browser/session/reporter/state
- call OpenClaw runner

After refactor, `execution/job-search.js` should stop owning:
- platform execution order
- batch orchestration
- dedup save timing
- platform-specific stop logic

### 2. New OpenClaw Layer
Add:
- `execution/openclaw/runner.js`
- `execution/openclaw/state.js`
- `execution/openclaw/policies.js`
- `execution/openclaw/tasks/index.js`
- `execution/openclaw/tasks/facebook-search.js`
- `execution/openclaw/tasks/twitter-search.js`
- `execution/openclaw/tasks/threads-search.js`
- `execution/openclaw/tasks/board-search.js`
- `execution/openclaw/telemetry.js`

Responsibilities:

`runner.js`
- top-level deterministic orchestration
- execute tasks in correct order
- manage shared browser/context lifecycle
- produce run summary

`state.js`
- seen/stale cache interface
- retry counters
- per-platform last-run snapshots
- scan cursors / last successful depth if introduced later

`policies.js`
- scan limits per platform
- freshness policy
- stop conditions
- cooldown/backoff policy
- can-run / should-retry / should-stop rules

`tasks/*.js`
- adapt raw scrapers into OpenClaw task contracts
- collect results
- report warnings/errors in a standard shape

`telemetry.js`
- structured task logs
- run-level metrics
- counters for skipped/deduped/stale/AI-rejected jobs

### 3. Scrapers Become Deterministic Workers
Keep:
- `execution/scrapers/*.js`

Change:
- scrapers should focus on collecting raw candidate posts/jobs
- move more run-control logic out of scraper bodies and into task/policy layer over time

Examples of logic that should gradually move out of scrapers:
- "stop after 5 valid jobs"
- "scan 15 posts max"
- "retry one more time after timeout"
- "skip platform when login wall appears three times"
- "reduce scan depth when block risk is high"

### 4. Shared Policy Layer
Keep:
- `execution/lib/filters.js`
- `execution/lib/deduplication.js`
- `execution/lib/ai-filter.js`

Change:
- treat them as policy/services used by OpenClaw, not as ad-hoc helpers called from anywhere

Future split:
- `filters.js` stays deterministic
- `deduplication.js` becomes storage backend used by `openclaw/state.js`
- `ai-filter.js` becomes optional enrichment/validation stage in the pipeline

## What Should Be Removed Or Replaced

### Replace
Replace direct orchestration inside:
- `execution/job-search.js`

with:
- `execution/openclaw/runner.js`

### Gradually Remove From Scrapers
The following logic should be phased out of scraper files and relocated upward:
- per-group stop counts
- hardcoded per-platform run limits
- partial dedup decisions that belong to shared state
- retry timing decisions
- cross-platform business policy

This does not mean "delete immediately".
It means:
1. stabilize OpenClaw task contracts
2. move one policy at a time
3. keep scraper extraction logic intact

### Keep As-Is For Now
Do not rewrite immediately:
- DOM selectors
- cookie loading behavior
- Playwright stealth setup
- Telegram formatting
- AI prompt semantics unless they block orchestration

Those are working components and should be migrated only where they block the architecture.

## Migration Phases

### Phase 1. Introduce OpenClaw Without Behavior Change
Objective:
- add OpenClaw runner and task abstraction without changing scraper output semantics

Tasks:
- create `execution/openclaw/runner.js`
- create task adapters for current scrapers
- move platform execution ordering from `job-search.js` into runner
- move final run summary into runner

Success criteria:
- same platforms still run
- same Telegram output still works
- no meaningful behavior change yet

Current status:
- done: `job-search.js` is now a thinner bootstrap
- done: `openclaw/runner.js`, `state.js`, `policies.js`, `tasks/index.js`, `telemetry.js` exist
- done: task adapters now return a standardized task result wrapper
- done: run-level telemetry JSON is persisted to `logs/openclaw-run-*.json`

### Phase 2. Move State And Policy Into OpenClaw
Objective:
- centralize scan decisions and cache ownership

Tasks:
- wrap `loadSeenJobs/saveSeenJobs` behind `openclaw/state.js`
- model `seen`, `stale`, `sent`, `retryable`, `blocked`
- move stop conditions into `openclaw/policies.js`
- expose policy config per platform

Success criteria:
- one canonical place decides:
  - freshness
  - stale handling
  - stop-after-N-new-jobs
  - max scan depth
  - retry/backoff

Current status:
- partial: seen/stale/sent cache ownership is now routed through `openclaw/state.js`
- partial: per-platform timeout policy is now centralized in `openclaw/policies.js`
- partial: Facebook group orchestration now runs via `openclaw/tasks/facebook-search.js`, while per-group extraction still lives in the scraper
- partial: blocked/failed platform health is now persisted in `logs/platform-health.json`
- pending: retry/backoff is not yet modeled centrally

### Phase 3. Standardize Task Contracts
Objective:
- every platform task returns the same contract

Target contract:
```js
{
  platform: 'facebook',
  status: 'ok' | 'partial' | 'blocked' | 'failed',
  candidates: [],
  staleUrls: [],
  metrics: {
    scanned: 0,
    deduped: 0,
    stale: 0,
    newValid: 0
  },
  warnings: [],
  errors: []
}
```

Success criteria:
- runner can orchestrate all platforms uniformly
- platform health becomes visible and comparable

Current status:
- partial: every task now reports `platform`, `status`, `rawJobs`, `staleUrls`, `metrics`, `warnings`, `error`
- partial: task failures now go through a shared screenshot/Telegram skip path in the OpenClaw layer
- partial: several major scrapers now return `partial/blocked/failed` explicitly instead of silent empty results
- partial: task metrics now include richer counters such as scanned/raw/stale and feed into run-level drop reasons
- pending: task metrics should still grow to include more platform-native counters like per-batch retries

### Phase 4. Add OpenClaw Telemetry
Objective:
- make missed-job debugging practical

Tasks:
- structured logs per task
- run summary JSON artifact
- reason counters:
  - dropped by freshness
  - dropped by level
  - dropped by location
  - skipped as seen
  - skipped as stale
  - AI rejected

Success criteria:
- answer "why was this job missed?" from structured output instead of grep-heavy log reading

Current status:
- partial: run-level telemetry file exists and records task results, status counts, pipeline counts, and drop reasons
- partial: auth/session failures now capture screenshots and notify Telegram before the task is skipped
- partial: repeated blocked/failed platforms are tracked across runs via `platform-health.json`

### Phase 5. Optional Use Of Go OpenClaw Components
Objective:
- reuse ideas or subsystems from `go-openclaw-automation` only if they reduce duplicated logic

Safe reuse candidates:
- config shape
- dedup/state models
- reporter abstractions
- browser/session abstractions

Do not force:
- full migration from Node to Go
- dual runtime orchestration unless there is a real payoff

## Repo-Specific Recommendations

### Recommended New Layout
```text
execution/
  job-search.js
  openclaw/
    runner.js
    state.js
    policies.js
    telemetry.js
    tasks/
      index.js
      facebook-search.js
      twitter-search.js
      threads-search.js
      board-search.js
  scrapers/
  lib/
  utils/
```

### Files Most Likely To Shrink
- `execution/job-search.js`
- `execution/scrapers/facebook.js`
- `execution/scrapers/twitter.js`
- `execution/scrapers/linkedin.js` (currently inactive in runtime)

### Files Likely To Remain Important
- `execution/lib/filters.js`
- `execution/lib/deduplication.js`
- `execution/lib/ai-filter.js`
- `execution/lib/telegram.js`

## LLM Requirement
Short answer: no, OpenClaw does not need an LLM to be useful.

### OpenClaw Should Be Deterministic By Default
Use deterministic logic for:
- orchestration
- retries
- stop conditions
- state transitions
- cooldowns
- scan-depth decisions
- dedup
- stale handling

These are policy/system concerns and should not require an LLM brain.

### Where LLM Actually Helps
Use LLM only for tasks that benefit from semantic judgment:
- classify whether a post is a real hiring post
- infer role/location from noisy text
- normalize ambiguous multi-role content
- generate summaries or tailored content

### Recommendation For This Repo
Best design:
- OpenClaw runner: deterministic
- Scrapers: deterministic
- AI validator: optional semantic stage

That means:
- if Groq/LLM fails, the system still runs
- orchestration quality does not depend on model availability
- semantic understanding remains a pluggable enrichment step, not the system brain

## Acceptance Criteria
OpenClaw integration is successful when:
- `execution/job-search.js` becomes a thin bootstrap
- platform execution order is no longer hardcoded in the bootstrap
- state ownership is centralized
- stop conditions are policy-driven
- per-platform metrics are structured
- scraper files own less orchestration logic than today
- AI remains optional and non-critical for system control

## Immediate Next Steps
- [ ] Create `execution/openclaw/runner.js`
- [ ] Create `execution/openclaw/state.js`
- [ ] Create `execution/openclaw/policies.js`
- [ ] Move platform execution order out of `execution/job-search.js`
- [ ] Wrap current scraper calls into task contracts
- [ ] Move run summary and counters into structured telemetry
- [ ] Refactor Facebook scan limits into policy config
- [ ] Refactor Twitter/Threads search strategy into policy config
- [ ] Leave Playwright execution in scraper layer
- [ ] Keep AI as optional semantic validator, not orchestration brain
