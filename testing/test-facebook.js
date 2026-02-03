/**
 * Dedicated Test Script for Facebook Scraper
 */
require('dotenv').config();
const { chromium } = require('playwright');
const CONFIG = require('../execution/config');
const { scrapeFacebook } = require('../execution/scrapers/facebook');
const fs = require('fs');
const path = require('path');

// Mock Reporter
const reporter = {
    sendStatus: async (msg) => console.log(`[TELEGRAM] ${msg}`),
    sendError: async (msg) => console.error(`[ERROR] ${msg}`),
    sendJobReport: async (job) => console.log(`[JOB] ${job.title} - ${job.url}`)
};

async function runTest() {
    console.log('🚀 Starting Facebook Scraper Test...');

    // Use headful mode for Facebook to better simulate real user and debug easier
    const browser = await chromium.launch({
        headless: false, // VISIBLE BROWSER
        // channel: 'chrome', // REMOVED: Failed to install Chrome on this system. Using bundled Chromium.
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    // Load Facebook Cookies
    const cookiePath = path.join(CONFIG.paths.cookies, 'cookies-facebook.json');
    if (fs.existsSync(cookiePath)) {
        try {
            const cookieData = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
            // Support both direct array and object with 'cookies' property
            const cookies = Array.isArray(cookieData) ? cookieData : (cookieData.cookies || []);

            if (cookies.length > 0) {
                // Sanitize cookies for Playwright
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
                console.log(`🍪 Loaded ${cleanCookies.length} Facebook cookies`);
            } else {
                console.warn('⚠️ Cookie file found but empty or invalid format.');
            }
        } catch (e) {
            console.error('⚠️ Failed to load cookies:', e.message);
        }
    } else {
        console.warn('⚠️ No Facebook cookies found at ' + cookiePath);
        console.warn('   (You might hit a login wall immediately)');
    }

    const page = await context.newPage();

    try {
        const jobs = await scrapeFacebook(page, reporter);
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
