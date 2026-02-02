# OpenClaw Automation - Implementation Roadmap (Node.js)

## 1. Core Enhancements & Architecture
**Objective**: Optimize current Node.js architecture and integrate better AI.
- [ ] **Groq Integration**: Replace `@google/generative-ai` with Groq SDK (Model: `llama3-70b-8192`) for faster and cheaper text extraction.
- [ ] **Time Format**: Standardize all date displays in logs and Telegram messages to `YYYY-MM-DD HH:mm:ss`.
- [ ] **Config**: Centralize configuration (API keys, selectors) for easier management.

## 2. Expansion: Job Scraping
**Objective**: Widen the net for job opportunities while managing platform constraints.
- [ ] **Indeed**: Add scraping logic using keyword search (Playwright).
- [ ] **Facebook**: Implement public group scraping (keyword search, no login required to minimize risk).
- [ ] **Refinement**: Ensure unified duplicate detection across all platforms before sending to AI.

## 4. Expansion: Personal Monitoring
**Objective**: Monitor personal projects and interests.
- [ ] **Vercel Analytics**: Scrape portfolio project traffic every 4 hours.
    - *Condition*: Only notify if traffic > 0.
- [ ] **Rophim**: Scrape `rophim.com` for "Jujutsu Kaisen" new episodes every 4 hours.

## 5. Advanced: Email Tracking
**Objective**: Know when HR views your application.
- [ ] **Tracking Pixel**: Implement a tracking pixel generation and monitoring system.
    - *Mechanism*: Embed a unique 1x1 invisible image in emails.
    - *Server*: Simple endpoint to log hits and notify via Telegram.

## 6. Maintenance & Infrastructure
- [ ] **Cookie Management**: Document process for updating cookies (Facebook/LinkedIn/Vercel) if login is required.

