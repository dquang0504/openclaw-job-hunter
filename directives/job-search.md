# Job Search Directive

## Goal
Search for Golang/Go developer positions suitable for freshers, interns, and junior developers across TopCV.vn and X (Twitter).

## Inputs
- Search keywords (case-insensitive):
  - `golang fresher`
  - `remote intern golang`
  - `junior golang developer`
  - `golang backend intern`
  - `entry level golang`

- Location priority:
  1. Cần Thơ / Can Tho
  2. Remote / Work from home
  3. Worldwide / Global

## Expected Outputs
- Telegram messages with job details:
  - 🏢 Company name
  - 🔗 Direct link to job
  - 💰 Salary (if listed)
  - 📝 Tech stack summary
  - 🤖 Match score (1-10)

## Approved Execution Tools
- `execution/job-search.js` — Main scraper with Playwright
- `execution/setup-vm.sh` — One-time VM setup

## Constraints
1. **Inclusion criteria:**
   - Must mention Go, Golang, or Go Developer
   - Must be Fresher / Intern / Junior / Entry-level / Graduate

2. **Exclusion criteria (STRICT):**
   - Senior, Lead, Manager, Principal, Staff, Architect
   - Jobs requiring 3+ years of experience
   - Jobs with "2+ years" or similar experience requirements

3. **Stealth mode:**
   - Random delays 2-5 seconds between actions
   - Human-like scrolling behavior
   - Cookie-based session persistence
   - Rotate through keywords with delays

4. **CAPTCHA handling:**
   - Capture screenshot
   - Send to Telegram with alert
   - Pause and wait for `/proceed` command

## Schedule
- Run every 4 hours during active hours: 06:00, 10:00, 14:00, 18:00, 22:00 (Vietnam time)

## Known Issues & Learnings
- TopCV.vn: Rate limiting after ~50 requests, add 30-60 second cooldown between keyword searches
- X (Twitter): Requires valid session cookies, login wall appears without them
- LinkedIn: Aggressive bot detection, currently excluded from automation
