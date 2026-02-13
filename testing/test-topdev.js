/**
 * Dedicated Test Script for TopDev Scraper
 * Launches in Headful mode to observe behavior
 */
require('dotenv').config();
const { chromium } = require('playwright');
const CONFIG = require('../execution/config');
const { scrapeTopDev } = require('../execution/scrapers/topdev');
const fs = require('fs');
const path = require('path');

// Mock Reporter
const reporter = {
    sendStatus: async (msg) => console.log(`[TELEGRAM] ${msg}`),
    sendError: async (msg) => console.error(`[ERROR] ${msg}`),
    sendJobReport: async (job) => console.log(`[JOB] ${job.title} - ${job.company}`)
};

async function runTest() {
    console.log('🚀 Starting TopDev Scraper Test...');

    const browser = await chromium.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    // Create a context similar to main
    const context = await browser.newContext({
        viewport: { width: 1366, height: 768 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'vi-VN'
    });

    // Load cookies if available
    const cookiePath = path.join(__dirname, '../.cookies/cookies-topdev.json');
    if (fs.existsSync(cookiePath)) {
        const cookieData = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
        const cookies = Array.isArray(cookieData) ? cookieData : (cookieData.cookies || []);
        if (cookies.length > 0) {
            await context.addCookies(cookies.map(c => {
                if (c.sameSite === 'no_restriction' || c.sameSite === 'unspecified') c.sameSite = 'None';
                if (!['Strict', 'Lax', 'None'].includes(c.sameSite)) delete c.sameSite;
                return c;
            }));
            console.log('🍪 Loaded TopDev cookies');
        }
    }

    const page = await context.newPage();

    try {
        const jobs = await scrapeTopDev(page, reporter);
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
