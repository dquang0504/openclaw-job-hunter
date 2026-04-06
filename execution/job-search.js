/**
 * OpenClaw Job Search Automation
 * Main orchestration file
 * 
 * Flow:
 * 1. Scrape active platforms (Twitter, Facebook, Threads, Indeed, TopDev, ITViec, Vercel, Cloudflare)
 * 2. Collect ALL raw jobs
 * 3. ONE batch AI validation call for all jobs (G4F)
 * 4. Filter, deduplicate, and send to Telegram
 */

require('dotenv').config();
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const fs = require('fs');
const path = require('path');

// Import modules
const CONFIG = require('./config');
const TelegramReporter = require('./lib/telegram');
const { formatDateTime } = require('./utils/date');
const { createRunPolicy } = require('./openclaw/policies');
const { createRunState } = require('./openclaw/state');
const { runOpenClaw } = require('./openclaw/runner');
const { createRunTelemetry } = require('./openclaw/telemetry');

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function main() {
    const runPolicy = createRunPolicy(process.argv.slice(2));

    console.log(`🚀 Starting job search (dry-run: ${runPolicy.isDryRun}, platform: ${runPolicy.platformParam}, AI: ${!runPolicy.skipAI})`);
    console.log(`🕒 Execution started at: ${formatDateTime()}`);

    // Ensure directories exist
    for (const dir of Object.values(CONFIG.paths)) {
        const dirPath = path.dirname(dir);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    const reporter = new TelegramReporter();
    const runState = createRunState();
    const telemetry = createRunTelemetry(runPolicy);

    const browser = await chromium.launch({
        headless: false,
        timeout: 60000,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--window-size=1280,800',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-first-run',
            '--no-service-autorun',
            '--password-store=basic'
        ]
    });

    // Regular context for Twitter
    // Using Desktop User Agent (matches debug-browser.js success)
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
    console.log(`🕵️ Using User-Agent: ${userAgent}`);

    const contextOptions = {
        userAgent: userAgent,
        viewport: { width: 1280, height: 800 },
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh',
        // Minimal headers like debug-browser.js
        // permissions: ['geolocation'],
        // geolocation: { latitude: 10.7769, longitude: 106.7009 }, // HCM
        javaScriptEnabled: true,
        /* 
        extraHTTPHeaders: {
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"'
        } 
        */
    };

    // Proxy Configuration (Placeholder for future use)
    if (process.env.PROXY_SERVER) {
        contextOptions.proxy = {
            server: process.env.PROXY_SERVER,
            // username: process.env.PROXY_USERNAME,
            // password: process.env.PROXY_PASSWORD
        };
        console.log(`🌐 Using Proxy: ${process.env.PROXY_SERVER}`);
    }

    const context = await browser.newContext(contextOptions);

    // Load cookies
    const cookieFiles = {
        twitter: path.join(CONFIG.paths.cookies, 'cookies-twitter.json'),
        facebook: path.join(CONFIG.paths.cookies, 'cookies-facebook.json'),
        threads: path.join(CONFIG.paths.cookies, 'cookies-threads.json'),
        vercel: path.join(CONFIG.paths.cookies, 'cookies-vercel.json'),
        topdev: path.join(CONFIG.paths.cookies, 'cookies-topdev.json'),
        itviec: path.join(CONFIG.paths.cookies, 'cookies-itviec.json')
    };

    for (const [name, file] of Object.entries(cookieFiles)) {
        if (fs.existsSync(file)) {
            try {
                const cookieData = JSON.parse(fs.readFileSync(file, 'utf-8'));
                // Support both direct array and object with 'cookies' property (like EditThisCookie export)
                const cookies = Array.isArray(cookieData) ? cookieData : (cookieData.cookies || []);

                if (cookies.length > 0) {
                    // Sanitize cookies for Playwright (Fix sameSite: no_restriction)
                    const cleanCookies = cookies.map(c => {
                        if (c.sameSite === 'no_restriction' || c.sameSite === 'unspecified') {
                            c.sameSite = 'None';
                        }
                        // Ensure valid values: Strict, Lax, None
                        if (!['Strict', 'Lax', 'None'].includes(c.sameSite)) {
                            delete c.sameSite; // Let browser default
                        }
                        return c;
                    });

                    await context.addCookies(cleanCookies);
                    console.log(`🍪 Loaded ${name} cookies (${cleanCookies.length})`);
                }
            } catch (e) {
                console.warn(`⚠️ Failed to load ${name} cookies:`, e.message);
            }
        }
    }

    const page = await context.newPage();
    let allRawJobs = [];

    try {
        const runResult = await runOpenClaw({
            page,
            reporter,
            runPolicy,
            runState,
            telemetry
        });
        allRawJobs = runResult.allRawJobs;

        if (runResult.hadNoUnseenJobs) {
            const datedLogFile = path.join(CONFIG.paths.logs, `job-search-${new Date().toISOString().split('T')[0]}.json`);
            if (!fs.existsSync(CONFIG.paths.logs)) {
                fs.mkdirSync(CONFIG.paths.logs, { recursive: true });
            }
            fs.writeFileSync(datedLogFile, JSON.stringify(allRawJobs, null, 2));
        }
    } catch (error) {
        console.error('Fatal error:', error);
        await reporter.sendError(error.message);
    } finally {
        runState.persistSeenEntries(runPolicy.isDryRun);

        // Save results BEFORE closing browser to avoid "Page/browser was closed" error
        const safeTime = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        const logFile = path.join(CONFIG.paths.logs, `job-search-${safeTime}.json`);

        if (!fs.existsSync(CONFIG.paths.logs)) {
            fs.mkdirSync(CONFIG.paths.logs, { recursive: true });
        }
        fs.writeFileSync(logFile, JSON.stringify(allRawJobs, null, 2));
        console.log(`\n📁 Results saved to ${logFile}`);

        const telemetryLogFile = path.join(CONFIG.paths.logs, `openclaw-run-${safeTime}.json`);
        fs.writeFileSync(telemetryLogFile, JSON.stringify(telemetry.buildRunSummary(), null, 2));
        console.log(`📁 OpenClaw telemetry saved to ${telemetryLogFile}`);

        await browser.close();
    }
}

main().catch(console.error);
