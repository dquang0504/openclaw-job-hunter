/**
 * Dedicated Test Script for TopCV Scraper
 * Launches in Headful mode to observe behavior
 */
require('dotenv').config();
const { chromium } = require('playwright');
// Adjust path to config if necessary (e.g., '../execution/config')
const CONFIG = require('../execution/config');
const { scrapeTopCV } = require('../execution/scrapers/topcv');

// Mock Reporter
const reporter = {
    sendStatus: async (msg) => console.log(`[TELEGRAM] ${msg}`),
    sendError: async (msg) => console.error(`[ERROR] ${msg}`),
    sendJobReport: async (job) => console.log(`[JOB] ${job.title} - ${job.company}`)
};

async function runTest() {
    console.log('🚀 Starting TopCV Scraper Test...');

    // Use Headful mode to bypass simple bot checks & verify challenges
    const browser = await chromium.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled' // Critical for stealth
        ]
    });

    // Create a context similar to stealth settings
    const context = await browser.newContext({
        viewport: { width: 1366, height: 768 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'vi-VN'
    });

    // Load cookies if available (TopCV usually doesn't need login for basic search, but good to have)
    // const cookiePath = path.join(__dirname, '../.cookies/cookies-topcv.json');
    // if (fs.existsSync(cookiePath)) { ... }

    const page = await context.newPage();

    try {
        const jobs = await scrapeTopCV(page, reporter);

        console.log(`\n📦 Total Jobs Found: ${jobs.length}`);
        console.log(JSON.stringify(jobs, null, 2));

    } catch (e) {
        console.error('Test Failed:', e);
    } finally {
        console.log('✨ Test Complete. Closing browser in 5 seconds...');
        await page.waitForTimeout(5000);
        await browser.close();
    }
}

runTest();
