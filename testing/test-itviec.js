const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { scrapeITViec } = require('../execution/scrapers/itviec');
const CONFIG = require('../execution/config');

(async () => {
    console.log('🚀 Starting ITViec Scraper Test...');

    const browser = await chromium.launch({
        headless: false, // Run headful for debugging 
        args: ['--disable-blink-features=AutomationControlled']
    });

    // Create a new context with custom user agent and viewport
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: true
    });

    // Load Cookies for ITViec
    const cookiePath = path.resolve(__dirname, '../.cookies/cookies-itviec.json');
    if (fs.existsSync(cookiePath)) {
        try {
            const cookieData = fs.readFileSync(cookiePath, 'utf8');
            const cookies = JSON.parse(cookieData);
            // Ensure cookies are for the correct domain, clean up if needed
            const validCookies = cookies.map(c => {
                // Remove 'sameSite' if it causes issues, usually fine in Playwright
                if (c.sameSite === 'unspecified') delete c.sameSite;
                return c;
            });
            await context.addCookies(validCookies);
            console.log('🍪 Loaded ITViec cookies');
        } catch (e) {
            console.warn('⚠️ Failed to load cookies:', e.message);
        }
    } else {
        console.warn('⚠️ No cookies found at:', cookiePath);
    }

    const page = await context.newPage();

    // Mock Reporter
    const reporter = {
        sendTelegramMessage: (msg) => console.log(`[TELEGRAM] ${msg}`)
    };

    try {
        const jobs = await scrapeITViec(page, reporter);
        console.log(`\n📦 Total Jobs Found: ${jobs.length}`);
        console.log(JSON.stringify(jobs.slice(0, 3), null, 2)); // Preview first 3
    } catch (error) {
        console.error('❌ Test Failed:', error);
    } finally {
        console.log('✨ Test Complete. Closing browser in 5 seconds...');
        await new Promise(r => setTimeout(r, 5000));
        await browser.close();
    }
})();
