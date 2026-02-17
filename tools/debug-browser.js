
require('dotenv').config();
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const path = require('path');
const fs = require('fs');

async function debugBrowser() {
    console.log('🚀 Opening Chromium for Manual Debugging...');
    console.log('ℹ️  Browser will stay open. Press Ctrl+C in terminal to close.');

    // Launch Persistent Context (saves state/cookies directly)
    // Or just launch normal browser with our cookies loaded

    const browser = await chromium.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,800',
        ]
    });

    // Mobile User Agent (Chrome Android)
    const userAgent = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36';

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        // deviceScaleFactor: 1,
        // isMobile: false,
        // hasTouch: false,
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh'
    });

    const page = await context.newPage();

    // Load Cookies
    const cookieFile = path.join(__dirname, '../.cookies/cookies-facebook.json');
    if (fs.existsSync(cookieFile)) {
        try {
            const cookieData = JSON.parse(fs.readFileSync(cookieFile, 'utf-8'));
            const cookies = Array.isArray(cookieData) ? cookieData : (cookieData.cookies || []);
            await context.addCookies(cookies);
            console.log(`🍪 Loaded ${cookies.length} cookies from ${cookieFile}`);
        } catch (e) {
            console.error('⚠️ Failed to load cookies:', e.message);
        }
    } else {
        console.log('⚠️ No cookie file found at .cookies/cookies-facebook.json');
    }

    console.log('🌐 Navigating to facebook.com...');
    await page.goto('https://facebook.com');

    // Keep it open forever
    await new Promise(() => { });
}

debugBrowser();
