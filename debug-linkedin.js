const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const path = require('path');
const fs = require('fs');

async function main() {
    console.log('🚀 Launching Persistent Browser (LinkedIn Profile)...');

    // Use a persistent context directory
    const userDataDir = path.join(__dirname, '.tmp', 'linkedin-profile');
    if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
    }

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: null, // Let window size dictate
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--start-maximized'
        ],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        locale: 'en-US',
        timezoneId: 'Asia/Ho_Chi_Minh',
        permissions: ['geolocation'],
        geolocation: { latitude: 10.7769, longitude: 106.7009 },
        javaScriptEnabled: true
    });

    const page = await context.pages()[0] || await context.newPage();

    try {
        console.log('🔗 Navigating to LinkedIn...');
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        console.log('✅ Browser ready.');
        console.log('👉 Please LOG IN MANUALLY if required.');
        console.log('👉 Once logged in and on the Feed page, press Ctrl+C to stop this script.');
        console.log('👉 The cookies will be saved implicitly in the profile directory.');

        // Keep the script running to allow manual login
        await new Promise(() => { });

    } catch (e) {
        console.error('❌ Navigation failed:', e.message);
    }
}

main().catch(console.error);
