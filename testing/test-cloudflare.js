/**
 * Dedicated Test Script for Cloudflare Scraper
 */
require('dotenv').config();
const CONFIG = require('../execution/config');
const { scrapeCloudflare } = require('../execution/scrapers/cloudflare');
const fs = require('fs');

// Mock Reporter
const reporter = {
    sendStatus: async (msg) => console.log(`[TELEGRAM] ${msg}`),
    sendError: async (msg) => console.error(`[ERROR] ${msg}`),
    sendJobReport: async (job) => console.log(`[JOB] ${job.title} - ${job.company}`)
};

async function runTest() {
    console.log('🚀 Starting Cloudflare Scraper Test...');

    // Clear cache to force notification
    if (fs.existsSync(CONFIG.paths.cloudflareCache)) {
        console.log('  🧹 Clearing Cloudflare cache for test...');
        fs.unlinkSync(CONFIG.paths.cloudflareCache);
    }

    try {
        await scrapeCloudflare(reporter);

    } catch (e) {
        console.error('Test Failed:', e);
    } finally {
        console.log('✨ Test Complete.');
    }
}

runTest();
