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
        screenshots: path.join(__dirname, '..', '.tmp', 'screenshots'),
        seenJobs: path.join(__dirname, '..', 'logs', 'seen-jobs.json')
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
// GEMINI AI JOB FILTER (BATCH MODE - Single API call for all tweets)
// =============================================================================

/**
 * Batch validate multiple tweets with ONE Gemini API call
 * Input: Array of { id, text } objects
 * Returns: Map<id, { isJob, score, reason }>
 */
async function batchValidateJobsWithAI(tweets) {
    const results = new Map();

    // Fallback function using regex
    const regexValidate = (text) => {
        const hiringPatterns = /\b(is hiring|we're hiring|now hiring|#hiring|job opening|open position|hiring for|recruiting|apply now)\b/i;
        const personalPatterns = /\b(i need|i('m| am) looking|i want|my job|just asking|can't hate|first guy)\b/i;
        const isJob = hiringPatterns.test(text) && !personalPatterns.test(text);
        return { isJob, score: isJob ? 7 : 3, reason: 'regex' };
    };

    // If no AI, use regex for all
    if (!genAI) {
        console.log('  🔧 Using regex validation (no AI key)');
        for (const t of tweets) {
            results.set(t.id, regexValidate(t.text));
        }
        return results;
    }

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        // Build batch prompt
        const tweetList = tweets.map((t, i) => `[${i}] "${t.text.slice(0, 200)}"`).join('\n\n');

        const prompt = `Analyze these ${tweets.length} tweets. For EACH, determine if it's a REAL JOB POSTING (company hiring) or NOT (personal, question, sharing).

${tweetList}

Respond with ONLY a JSON array (no markdown, no explanation):
[{"id": 0, "isJob": true/false, "score": 1-10, "reason": "brief"}]

Score guide:
- 8-10: Clear job posting (company hiring, has role)
- 5-7: Likely job-related
- 1-4: NOT a job (personal seeking, question, sharing)`;

        console.log('  🤖 Sending batch to Gemini AI...');
        const result = await model.generateContent(prompt);
        const response = result.response.text().trim();

        // Parse JSON array response
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            for (const item of parsed) {
                const idx = parseInt(item.id);
                if (idx >= 0 && idx < tweets.length) {
                    results.set(tweets[idx].id, {
                        isJob: item.isJob === true,
                        score: Math.min(10, Math.max(1, parseInt(item.score) || 5)),
                        reason: item.reason || 'AI'
                    });
                }
            }
            console.log(`  ✅ AI processed ${results.size} tweets`);
        }
    } catch (error) {
        console.log('⚠️ AI batch failed, using regex:', error.message.slice(0, 100));
    }

    // Fill in any missing with regex fallback
    for (const t of tweets) {
        if (!results.has(t.id)) {
            results.set(t.id, regexValidate(t.text));
        }
    }

    return results;
}

// =============================================================================
// SEEN JOBS TRACKER (Deduplication)
// =============================================================================

/**
 * Load previously seen job URLs from file
 * Returns: Set of job URLs that have been sent before
 */
function loadSeenJobs() {
    try {
        if (fs.existsSync(CONFIG.paths.seenJobs)) {
            const data = JSON.parse(fs.readFileSync(CONFIG.paths.seenJobs, 'utf-8'));
            // Filter out entries older than 30 days
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            const validEntries = data.filter(entry => entry.timestamp > thirtyDaysAgo);
            console.log(`📋 Loaded ${validEntries.length} previously seen jobs`);
            return new Set(validEntries.map(e => e.url));
        }
    } catch (e) {
        console.log('⚠️ Could not load seen jobs:', e.message);
    }
    return new Set();
}

/**
 * Save seen job URLs to file for future runs
 */
function saveSeenJobs(seenUrls) {
    try {
        // Load existing and merge
        let existingData = [];
        if (fs.existsSync(CONFIG.paths.seenJobs)) {
            existingData = JSON.parse(fs.readFileSync(CONFIG.paths.seenJobs, 'utf-8'));
        }

        // Add new entries with timestamp
        const now = Date.now();
        for (const url of seenUrls) {
            if (!existingData.some(e => e.url === url)) {
                existingData.push({ url, timestamp: now });
            }
        }

        // Filter out entries older than 30 days
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
        existingData = existingData.filter(e => e.timestamp > thirtyDaysAgo);

        fs.writeFileSync(CONFIG.paths.seenJobs, JSON.stringify(existingData, null, 2));
        console.log(`💾 Saved ${existingData.length} seen jobs to cache`);
    } catch (e) {
        console.log('⚠️ Could not save seen jobs:', e.message);
    }
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

    // Use all keywords from CONFIG
    console.log(`  🔍 Searching with ${CONFIG.keywords.length} keywords...`);

    for (const keyword of CONFIG.keywords) {
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

    // Build search query from CONFIG keywords
    // Take first 3 keywords for Twitter to avoid query too long
    const keywordPart = CONFIG.keywords.slice(0, 3).map(k => `"${k}"`).join(' OR ');
    const searchQuery = `(${keywordPart}) (job OR hiring) (fresher OR junior OR intern) -senior -5년`;
    console.log(`  🔍 Query: ${searchQuery.slice(0, 60)}...`);

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

        const tweetElements = await page.locator('[data-testid="tweet"]').all();
        console.log(`  📦 Found ${tweetElements.length} tweets`);

        // STEP 1: Collect all tweet data first
        const tweetData = [];
        for (let i = 0; i < Math.min(tweetElements.length, 10); i++) {
            try {
                const tweet = tweetElements[i];
                const text = await tweet.locator('[data-testid="tweetText"]').textContent().catch(() => null);
                if (!text) continue;

                const authorHandle = await tweet.locator('[data-testid="User-Name"] a').first().getAttribute('href').catch(() => null);
                const tweetLink = await tweet.locator('a[href*="/status/"]').first().getAttribute('href').catch(() => null);
                const timeEl = await tweet.locator('time').first();
                const dateTime = await timeEl.getAttribute('datetime').catch(() => null);

                tweetData.push({
                    id: i,
                    text,
                    authorHandle,
                    tweetLink,
                    postedDate: dateTime ? new Date(dateTime).toLocaleDateString('vi-VN') : 'N/A'
                });
            } catch (e) {
                // Skip malformed
            }
        }

        console.log(`  📝 Collected ${tweetData.length} tweets for validation`);

        // STEP 2: Batch validate with AI (SINGLE API CALL!)
        const validationResults = await batchValidateJobsWithAI(tweetData);

        // STEP 3: Build job list from validated tweets
        for (const t of tweetData) {
            const validation = validationResults.get(t.id) || { isJob: false, score: 0 };

            if (!validation.isJob || validation.score < 6) {
                console.log(`    ❌ [${validation.score}] ${t.text.slice(0, 35)}...`);
                continue;
            }

            const job = {
                title: t.text?.slice(0, 100)?.trim() + '...',
                company: t.authorHandle?.replace('/', '') || 'Twitter Post',
                url: t.tweetLink ? `https://x.com${t.tweetLink}` : 'https://x.com',
                description: t.text,
                location: 'Remote/Global',
                source: 'X (Twitter)',
                techStack: 'Go/Golang',
                postedDate: t.postedDate,
                matchScore: validation.score,
                aiReason: validation.reason
            };

            jobs.push(job);
            console.log(`    ✅ [${validation.score}/10] ${job.title.slice(0, 35)}...`);

            if (jobs.length >= 5) break;
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

        // Load previously seen jobs for deduplication
        const seenJobs = loadSeenJobs();

        // Filter out already-seen jobs
        const newJobs = allJobs.filter(job => !seenJobs.has(job.url));
        console.log(`\n📊 Found ${allJobs.length} jobs total, ${newJobs.length} are NEW`);

        if (newJobs.length === 0) {
            console.log('ℹ️ No new jobs found - all have been seen before');
            // Don't send notification when no new jobs to avoid spam
        } else {
            // Report top 5 NEW jobs only
            const jobsToSend = newJobs.slice(0, 5);
            const sentUrls = [];

            for (const job of jobsToSend) {
                console.log(`  [${job.matchScore}/10] ${job.title} @ ${job.company}`);

                if (!isDryRun) {
                    await reporter.sendJobReport(job);
                    await randomDelay(500, 1000); // Rate limit Telegram
                }
                sentUrls.push(job.url);
            }

            // Save newly sent jobs to seen list
            if (!isDryRun && sentUrls.length > 0) {
                saveSeenJobs(sentUrls);
            }

            await reporter.sendStatus(`✅ Tìm được ${allJobs.length} jobs (${newJobs.length} mới), đã gửi ${jobsToSend.length} jobs mới.`);
        }

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
