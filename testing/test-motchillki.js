/**
 * Dedicated Test Script for Rophim Scraper
 * Multi-scenario testing for episode notification logic.
 */
require('dotenv').config();
const { chromium } = require('playwright');
const { scrapeMotchillki } = require('../execution/scrapers/motchillki');

// Mock Reporter
const reporter = {
    sendStatus: async (msg) => console.log(`[TELEGRAM] ${msg}`),
    sendError: async (msg) => console.error(`[ERROR] ${msg}`),
    sendJobReport: async (job) => console.log(`[JOB] ${job.title}`)
};

async function runTest() {
    console.log('🚀 Starting Motchillki Test Suite...');

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        // --- Test Case 1: Pretend we only saw Ep 1 ---
        // Expected: Should detect Ep 5 (assuming site has Ep 5) and Notify
        console.log('\n🔵 TEST CASE 1: Last Seen = Ep 1');
        await scrapeMotchillki(page, reporter, { lastSeenEp: 1, dryRun: true });

        // --- Test Case 2: Pretend we saw Ep 4 ---
        // Expected: Should detect Ep 5 and Notify (5 > 4)
        console.log('\n🔵 TEST CASE 2: Last Seen = Ep 4');
        await scrapeMotchillki(page, reporter, { lastSeenEp: 4, dryRun: true });

        // --- Test Case 3: Pretend we saw Ep 5 (Current Max) ---
        // Expected: Should NOT notify (5 == 5)
        console.log('\n🔵 TEST CASE 3: Last Seen = Ep 5');
        await scrapeMotchillki(page, reporter, { lastSeenEp: 5, dryRun: true });

        // --- Test Case 4: Pretend we saw Ep 6 (Future) ---
        // Expected: Should NOT notify (5 < 6)
        console.log('\n🔵 TEST CASE 4: Last Seen = Ep 6');
        await scrapeMotchillki(page, reporter, { lastSeenEp: 6, dryRun: true });

    } catch (e) {
        console.error('Test Failed:', e);
    } finally {
        await browser.close();
        console.log('\n✨ All Tests Complete');
    }
}

runTest();
