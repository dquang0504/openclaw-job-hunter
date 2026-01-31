# 🦀 OpenClaw Job Hunter

Automated job search bot for Golang positions across TopCV.vn and X (Twitter) with Telegram notifications.

## Features

- 🔍 **Multi-platform search**: TopCV.vn + X/Twitter
- 🤖 **Smart filtering**: Only Golang/Go jobs, Intern/Junior/Fresher level
- 📱 **Telegram reports**: Real-time job notifications with links
- 🕵️ **Stealth mode**: Random delays, human-like scrolling
- 🍪 **Session persistence**: Cookie-based authentication
- ⏰ **Scheduled runs**: GitHub Actions every 4 hours

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/openclaw-automation.git
cd openclaw-automation
npm install
npx playwright install chromium
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your Telegram credentials
```

### 3. Add Cookies (Optional)

```bash
mkdir -p .cookies
# Export cookies from browser using Cookie-Editor extension
# Save as .cookies/cookies-twitter.json and .cookies/cookies-topcv.json
```

### 4. Run

```bash
# Dry run (no Telegram messages)
npm run search:dry

# Full run with Telegram notifications
npm run search
```

## GitHub Actions Setup

1. Fork this repository
2. Add secrets in Settings → Secrets:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `COOKIES_TWITTER` (JSON content)
   - `COOKIES_TOPCV` (JSON content)
3. Enable Actions - runs every 4 hours automatically

## Project Structure

```
├── execution/
│   └── job-search.js      # Main automation script
├── docs/                   # Setup guides
├── .github/workflows/      # CI/CD configuration
└── package.json
```

## Configuration

Edit `execution/job-search.js` CONFIG section:

- **keywords**: Job search terms
- **delays**: Stealth timing
- **maxJobs**: Results limit (default: 5)

## License

MIT
