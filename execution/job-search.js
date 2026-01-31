/**
 * OpenClaw Job Search Automation
 * Searches TopCV.vn and X (Twitter) for Golang jobs
 * 
 * Features:
 * - Case-insensitive keyword matching
 * - Stealth mode with random delays
 * - Cookie-based session persistence
 * - Telegram reporting with CAPTCHA handling
 */

require('dotenv').config();
const { chromium } = require('playwright');
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

// Initialize Gemini AI (optional - will fallback to regex if no API key)
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
    keywords: [
        'golang fresher',
        'remote intern golang',
        'junior golang developer',
        'golang backend intern',
        'entry level golang',
        'go developer fresher',
        'golang internship'
    ],
    keywordRegex: /\b(golang|go\s+developer|go\s+backend)\b/i,
    excludeRegex: /\b(senior|lead|manager|principal|staff|architect|\d{2,}\+?\s*years?|[3-9]\s*years?)\b/i,
    includeRegex: /\b(fresher|intern|junior|entry[\s-]?level|graduate|trainee)\b/i,

    locations: {
        primary: ['cần thơ', 'can tho', 'remote', 'từ xa'],
        secondary: ['ho chi minh', 'hồ chí minh', 'hanoi', 'hà nội', 'worldwide', 'global']
    },

    delays: {
        min: 500,   // 0.5 seconds (faster for GitHub Actions)
        max: 1500,  // 1.5 seconds
        scroll: { min: 200, max: 500 },
        typing: { min: 30, max: 80 }
    },

    paths: {
        cookies: path.join(__dirname, '..', '.cookies'),
        logs: path.join(__dirname, '..', 'logs'),
        screenshots: path.join(__dirname, '..', '.tmp', 'screenshots')
    }
};

// =============================================================================
// TELEGRAM REPORTER
// =============================================================================

class TelegramReporter {
    constructor() {
        this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
        this.chatId = process.env.TELEGRAM_CHAT_ID;
        this.waitingForConfirmation = false;
    }

    async sendJobReport(job) {
        const message = [
            `🏢 *${this.escapeMarkdown(job.company)}*`,
            `🔗 [View Job](${job.url})`,
            job.salary ? `💰 ${this.escapeMarkdown(job.salary)}` : '',
            `📝 ${this.escapeMarkdown(job.techStack || 'N/A')}`,
            `📍 ${this.escapeMarkdown(job.location || 'N/A')}`,
            job.postedDate ? `📅 ${this.escapeMarkdown(job.postedDate)}` : '',
            `🤖 Match Score: ${job.matchScore}/10`,
            `🔖 Source: ${job.source}`
        ].filter(Boolean).join('\n');

        await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
    }

    async sendCaptchaAlert(screenshotPath) {
        await this.bot.sendMessage(this.chatId,
            '🚨 *CAPTCHA Detected!*\nPlease solve manually and reply `/proceed` to continue.',
            { parse_mode: 'Markdown' }
        );
        await this.bot.sendPhoto(this.chatId, screenshotPath);
        this.waitingForConfirmation = true;
    }

    async sendStatus(message) {
        await this.bot.sendMessage(this.chatId, `ℹ️ ${message}`);
    }

    async sendError(error) {
        await this.bot.sendMessage(this.chatId, `❌ Error: ${error}`);
    }

    escapeMarkdown(text) {
        return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
    }
}

// =============================================================================
// GEMINI AI JOB FILTER
// =============================================================================

/**
 * Use Gemini AI to validate if a post is a real job posting
 * Returns: { isJob: boolean, score: number (1-10), reason: string }
 */
async function validateJobWithAI(text) {
    if (!genAI) {
        // Fallback: use simple regex validation
        const hiringPatterns = /\b(is hiring|we're hiring|now hiring|#hiring|job opening|open position)\b/i;
        const personalPatterns = /\b(i need|i('m| am) looking|i want|my job|just asking)\b/i;
        const isJob = hiringPatterns.test(text) && !personalPatterns.test(text);
        return { isJob, score: isJob ? 7 : 0, reason: 'regex fallback' };
    }

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const prompt = `Analyze this tweet and determine if it's a REAL JOB POSTING (someone hiring), not someone looking for a job.

Tweet: "${text.slice(0, 500)}"

Respond with ONLY valid JSON (no markdown):
{"isJob": true/false, "score": 1-10, "reason": "brief reason"}

Score guide:
- 9-10: Clear job posting with company name and role
- 7-8: Likely job posting (hiring language)
- 4-6: Unclear, might be job-related
- 1-3: Not a job posting (personal, question, sharing)`;

        const result = await model.generateContent(prompt);
        const response = result.response.text().trim();

        // Parse JSON response (handle markdown code blocks)
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                isJob: parsed.isJob === true,
                score: Math.min(10, Math.max(1, parseInt(parsed.score) || 5)),
                reason: parsed.reason || 'AI analyzed'
            };
        }
    } catch (error) {
        console.log('⚠️ AI validation failed, using regex fallback:', error.message);
    }

    // Fallback on error
    return { isJob: true, score: 5, reason: 'AI error, fallback' };
}

// =============================================================================
// STEALTH UTILITIES
// =============================================================================

function randomDelay(min = CONFIG.delays.min, max = CONFIG.delays.max) {
    return new Promise(resolve =>
        setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
    );
}

async function humanScroll(page) {
    const scrollAmount = Math.floor(Math.random() * 300) + 200;
    await page.mouse.wheel(0, scrollAmount);
    await randomDelay(CONFIG.delays.scroll.min, CONFIG.delays.scroll.max);
}

async function humanType(page, selector, text) {
    await page.click(selector);
    for (const char of text) {
        await page.keyboard.type(char);
        await randomDelay(CONFIG.delays.typing.min, CONFIG.delays.typing.max);
    }
}

// =============================================================================
// JOB FILTERS
// =============================================================================

function calculateMatchScore(job) {
    let score = 0;
    const text = `${job.title} ${job.description || ''} ${job.company}`.toLowerCase();

    // Golang mention (+3)
    if (CONFIG.keywordRegex.test(text)) score += 3;

    // Level match (+3)
    if (CONFIG.includeRegex.test(text)) score += 3;

    // Location priority (+2 for primary, +1 for secondary)
    const location = (job.location || '').toLowerCase();
    if (CONFIG.locations.primary.some(l => location.includes(l))) score += 2;
    else if (CONFIG.locations.secondary.some(l => location.includes(l))) score += 1;

    // Tech stack bonus (+1)
    if (/\b(docker|kubernetes|aws|gcp|microservices|rest\s*api|grpc)\b/i.test(text)) score += 1;

    return Math.min(score, 10);
}

function shouldIncludeJob(job) {
    const text = `${job.title} ${job.description || ''}`.toLowerCase();

    // Must contain golang/go
    if (!CONFIG.keywordRegex.test(text)) return false;

    // Exclude senior/lead/manager or >2 years
    if (CONFIG.excludeRegex.test(text)) return false;

    return true;
}

// =============================================================================
// TOPCV.VN SCRAPER
// =============================================================================

async function scrapeTopCV(page, reporter) {
    console.log('📋 Searching TopCV.vn...');

    const jobs = [];

    // TopCV search keywords - limit to 1-2 for speed
    const searchTerms = ['golang', 'go developer'];

    for (const keyword of searchTerms) {
        try {
            // Correct TopCV search URL format with query parameter
            const searchUrl = `https://www.topcv.vn/tim-viec-lam-it?keyword=${encodeURIComponent(keyword)}`;
            console.log(`  🔍 Searching: ${keyword}`);

            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await randomDelay(500, 1000);

            // Check for CAPTCHA
            if (await page.locator('.captcha, .recaptcha, [data-captcha]').count() > 0) {
                const screenshotPath = path.join(CONFIG.paths.screenshots, `captcha-topcv-${Date.now()}.png`);
                await page.screenshot({ path: screenshotPath, fullPage: true });
                await reporter.sendCaptchaAlert(screenshotPath);
                console.log('⚠️ CAPTCHA detected, waiting for manual resolution...');
                continue;
            }

            // Wait for job cards to load
            await page.waitForSelector('.job-item-search-result, .job-list-2', { timeout: 10000 }).catch(() => { });

            // Quick scroll once
            await humanScroll(page);

            // Extract job listings - updated selectors for TopCV's actual structure
            const jobCards = await page.locator('.job-item-search-result, .box-job-item').all();
            console.log(`  📦 Found ${jobCards.length} job cards`);

            for (const card of jobCards.slice(0, 5)) { // Limit to 5 for speed
                try {
                    const titleEl = card.locator('h3.title a, .title-block a, a.title').first();
                    const title = await titleEl.textContent().catch(() => null);
                    const url = await titleEl.getAttribute('href').catch(() => null);

                    const company = await card.locator('.company-name a, .company a, .employer-name').first().textContent().catch(() => 'Unknown');
                    const salary = await card.locator('.salary, .label-salary, .box-job-item__salary').first().textContent().catch(() => null);
                    const location = await card.locator('.address, .location, .label-address').first().textContent().catch(() => null);

                    if (!title) continue;

                    const job = {
                        title: title.trim(),
                        company: company.trim(),
                        url: url?.startsWith('http') ? url : `https://www.topcv.vn${url}`,
                        salary: salary?.trim(),
                        location: location?.trim(),
                        source: 'TopCV.vn',
                        techStack: 'Go, Backend'
                    };

                    // Include if contains golang/go keywords
                    const jobText = `${job.title} ${job.company}`.toLowerCase();
                    if (jobText.includes('go') || jobText.includes('golang') || jobText.includes('backend')) {
                        if (!CONFIG.excludeRegex.test(jobText)) {
                            job.matchScore = calculateMatchScore(job);
                            jobs.push(job);
                            console.log(`    ✅ ${job.title}`);
                        }
                    }
                } catch (e) {
                    // Skip malformed cards
                }
            }

            await randomDelay(1000, 2000); // Brief delay between searches
        } catch (error) {
            console.error(`Error searching "${keyword}":`, error.message);
        }
    }

    // Remove duplicates by URL
    const uniqueJobs = [...new Map(jobs.map(j => [j.url, j])).values()];
    return uniqueJobs;
}

// =============================================================================
// X (TWITTER) SCRAPER
// =============================================================================

async function scrapeTwitter(page, reporter) {
    console.log('🐦 Searching X (Twitter)...');

    const jobs = [];
    const searchQuery = 'golang job OR "go developer" job (fresher OR junior OR intern) -senior';

    try {
        await page.goto(`https://x.com/search?q=${encodeURIComponent(searchQuery)}&f=live`,
            { waitUntil: 'domcontentloaded', timeout: 20000 });
        await randomDelay(1000, 2000);

        // Wait for tweets to appear
        await page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 }).catch(() => { });

        // Check for login wall or CAPTCHA
        if (await page.locator('[data-testid="LoginForm"]').count() > 0) {
            console.log('⚠️ Twitter requires login, skipping...');
            await reporter.sendStatus('⚠️ X requires login - skipping (ensure cookies are valid)');
            return jobs;
        }

        // Quick scroll once
        await humanScroll(page);

        const tweets = await page.locator('[data-testid="tweet"]').all();
        console.log(`  📦 Found ${tweets.length} tweets`);

        // Use AI for validation if available, otherwise regex fallback
        const useAI = !!genAI;
        console.log(`  🤖 Using ${useAI ? 'Gemini AI' : 'regex'} for job validation`);

        for (const tweet of tweets.slice(0, 15)) { // Check first 15, filter down
            try {
                const text = await tweet.locator('[data-testid="tweetText"]').textContent();

                // Validate with AI or regex
                const validation = await validateJobWithAI(text);

                if (!validation.isJob || validation.score < 6) {
                    console.log(`    ❌ Skipped (score: ${validation.score}): ${text.slice(0, 40)}...`);
                    continue;
                }

                const authorHandle = await tweet.locator('[data-testid="User-Name"] a').first().getAttribute('href');
                const tweetLink = await tweet.locator('a[href*="/status/"]').first().getAttribute('href');

                // Extract date from tweet
                const timeEl = await tweet.locator('time').first();
                const dateTime = await timeEl.getAttribute('datetime').catch(() => null);
                const postedDate = dateTime ? new Date(dateTime).toLocaleDateString('vi-VN') : 'N/A';

                // Extract job-like info
                const job = {
                    title: text?.slice(0, 100)?.trim() + '...',
                    company: authorHandle?.replace('/', '') || 'Twitter Post',
                    url: tweetLink ? `https://x.com${tweetLink}` : 'https://x.com',
                    description: text,
                    location: 'Remote/Global',
                    source: 'X (Twitter)',
                    techStack: 'Go/Golang',
                    postedDate: postedDate,
                    matchScore: validation.score,  // Use AI score
                    aiReason: validation.reason
                };

                jobs.push(job);
                console.log(`    ✅ [${validation.score}/10] ${job.title.slice(0, 40)}...`);

                // Limit to 5 jobs
                if (jobs.length >= 5) break;
            } catch (e) {
                // Skip malformed tweets
            }
        }
    } catch (error) {
        console.error('Error searching Twitter:', error.message);
        await reporter.sendError(`Twitter search failed: ${error.message}`);
    }

    return jobs;
}

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function main() {
    const isDryRun = process.argv.includes('--dry-run');
    const platformArg = process.argv.find(a => a.startsWith('--platform='));
    const platform = platformArg ? platformArg.split('=')[1] : 'all';

    console.log(`🚀 Starting job search (dry-run: ${isDryRun}, platform: ${platform})`);

    // Ensure directories exist
    fs.mkdirSync(CONFIG.paths.screenshots, { recursive: true });
    fs.mkdirSync(CONFIG.paths.logs, { recursive: true });

    const reporter = new TelegramReporter();

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'vi-VN'
    });

    // Load cookies if available
    const cookieFiles = {
        'topcv': path.join(CONFIG.paths.cookies, 'cookies-topcv.json'),
        'twitter': path.join(CONFIG.paths.cookies, 'cookies-twitter.json')
    };

    for (const [name, file] of Object.entries(cookieFiles)) {
        if (fs.existsSync(file)) {
            try {
                const cookies = JSON.parse(fs.readFileSync(file, 'utf-8'));
                await context.addCookies(cookies);
                console.log(`🍪 Loaded ${name} cookies`);
            } catch (e) {
                console.warn(`⚠️ Failed to load ${name} cookies:`, e.message);
            }
        }
    }

    const page = await context.newPage();
    let allJobs = [];

    try {
        if (platform === 'all' || platform === 'topcv') {
            const topcvJobs = await scrapeTopCV(page, reporter);
            allJobs = allJobs.concat(topcvJobs);
        }

        if (platform === 'all' || platform === 'twitter') {
            const twitterJobs = await scrapeTwitter(page, reporter);
            allJobs = allJobs.concat(twitterJobs);
        }

        // Sort by match score
        allJobs.sort((a, b) => b.matchScore - a.matchScore);

        // Report top 5 jobs only
        console.log(`\n📊 Found ${allJobs.length} matching jobs:`);

        for (const job of allJobs.slice(0, 5)) { // Top 5 only
            console.log(`  [${job.matchScore}/10] ${job.title} @ ${job.company}`);

            if (!isDryRun) {
                await reporter.sendJobReport(job);
                await randomDelay(500, 1000); // Rate limit Telegram
            }
        }

        await reporter.sendStatus(`✅ Tìm được ${allJobs.length} jobs, đã gửi top ${Math.min(5, allJobs.length)}.`);

    } catch (error) {
        console.error('Fatal error:', error);
        await reporter.sendError(error.message);
    } finally {
        await browser.close();
    }

    // Save results to log
    const logFile = path.join(CONFIG.paths.logs, `job-search-${new Date().toISOString().split('T')[0]}.json`);
    fs.writeFileSync(logFile, JSON.stringify(allJobs, null, 2));
    console.log(`\n📁 Results saved to ${logFile}`);
}

main().catch(console.error);
