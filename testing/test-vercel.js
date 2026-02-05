/**
 * Dedicated Test Script for Vercel Scraper
 */
require('dotenv').config();
const { chromium } = require('playwright');
const CONFIG = require('../execution/config');
const { scrapeVercel } = require('../execution/scrapers/vercel');
const fs = require('fs');
const path = require('path');

// Mock Reporter
const reporter = {
    sendStatus: async (msg) => console.log(`[TELEGRAM] ${msg}`),
    sendError: async (msg) => console.error(`[ERROR] ${msg}`),
    sendJobReport: async (job) => console.log(`[JOB] ${job.title}`)
};

async function runTest() {
    console.log('🚀 Starting Vercel Test...');

    // Clear cache for testing
    const cacheFile = CONFIG.paths.vercelCache;
    if (fs.existsSync(cacheFile)) {
        fs.unlinkSync(cacheFile);
        console.log('🧹 Cache cleared for new test');
    }

    const browser = await chromium.launch({
        headless: true, // Keep headless for speed, user can change to false to debug visually
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        viewport: { width: 1366, height: 768 }
    });

    // Load Vercel Cookies
    const cookiePath = path.join(CONFIG.paths.cookies, 'cookies-vercel.json');
    if (fs.existsSync(cookiePath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
        await context.addCookies(cookies);
        console.log('🍪 Vercel cookies loaded');
    } else {
        console.warn('⚠️ No Vercel cookies found at ' + cookiePath);
    }

    const page = await context.newPage();

    try {
        await scrapeVercel(page, reporter);
    } catch (e) {
        console.error('Test Failed:', e);
    } finally {
        await browser.close();
        console.log('✨ Test Complete');
    }
}

runTest();
