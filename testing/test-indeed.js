/**
 * Dedicated Test Script for Indeed Scraper
 * Launches in Headful mode to observe Cloudflare challenges
 */
require('dotenv').config();
const { chromium } = require('playwright');
const CONFIG = require('../execution/config');
const { scrapeIndeed } = require('../execution/scrapers/indeed');

// Mock Reporter
const reporter = {
    sendStatus: async (msg) => console.log(`[TELEGRAM] ${msg}`),
    sendError: async (msg) => console.error(`[ERROR] ${msg}`),
    sendJobReport: async (job) => console.log(`[JOB] ${job.title} - ${job.company}`)
};

async function runTest() {
    console.log('🚀 Starting Indeed Scraper Test...');

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

    const page = await context.newPage();

    try {
        const jobs = await scrapeIndeed(page, reporter);

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
