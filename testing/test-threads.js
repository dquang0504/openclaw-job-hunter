/**
 * Test Threads Scraper
 * Run: node testing/test-threads.js
 */

require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { scrapeThreads, scrapeThreadsParallel } = require('../execution/scrapers/threads');
const TelegramReporter = require('../execution/lib/telegram');

async function testThreads() {
    console.log('🧪 Testing Threads Scraper (Parallel Mode)...\n');

    const browser = await chromium.launch({
        headless: false, // Show browser for debugging
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--ignore-certificate-errors',
            '--lang=vi-VN,vi'
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh',
        extraHTTPHeaders: {
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
            'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"'
            // NOTE: Không set 'Upgrade-Insecure-Requests', 'Accept', 'Sec-Fetch-*' thủ công!
            // Các header đó khi set thủ công sẽ bị gửi trong CORS preflight
            // → CDN Instagram block → trang trắng.
        }
    });

    // Load Threads cookies
    const cookieFile = path.join(__dirname, '../.cookies/cookies-threads.json');

    if (fs.existsSync(cookieFile)) {
        try {
            const cookieData = JSON.parse(fs.readFileSync(cookieFile, 'utf-8'));
            const cookies = Array.isArray(cookieData) ? cookieData : (cookieData.cookies || []);

            // Sanitize cookies for Playwright
            const cleanCookies = cookies.map(c => {
                if (c.sameSite === 'no_restriction' || c.sameSite === 'unspecified') {
                    c.sameSite = 'None';
                }
                if (!['Strict', 'Lax', 'None'].includes(c.sameSite)) {
                    delete c.sameSite;
                }
                return c;
            });

            await context.addCookies(cleanCookies);
            console.log(`🍪 Loaded ${cleanCookies.length} Threads cookies`);
            console.log(`   Domains: ${[...new Set(cleanCookies.map(c => c.domain))].join(', ')}\n`);
        } catch (e) {
            console.warn(`⚠️ Failed to load cookies: ${e.message}\n`);
        }
    } else {
        console.warn('⚠️ No cookies file found. Scraper may not work without authentication.\n');
    }

    const page = await context.newPage();

    // Verify login status
    console.log('🔐 Verifying login status...');
    try {
        await page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
        // ERR_HTTP_RESPONSE_CODE_FAILURE: Threads may redirect or block, try waiting for URL change
        console.log(`  ⚠️ goto error (${e.message.split('\n')[0]}), waiting for page to settle...`);
        try {
            await page.waitForURL('**', { timeout: 10000 });
        } catch (_) { }
    }
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    const pageContent = await page.content();

    console.log(`   Current URL: ${currentUrl}`);

    // Check if we need to click "Continue with Instagram" button
    if (pageContent.includes('Tiếp tục bằng Instagram') || pageContent.includes('Continue with Instagram')) {
        console.log('   🔄 Found "Continue with Instagram" button, clicking...');

        try {
            // Try to find and click the Instagram login button
            const instagramButton = page.locator('div[role="button"]').filter({ hasText: /Tiếp tục bằng Instagram|Continue with Instagram/i }).first();

            if (await instagramButton.isVisible({ timeout: 5000 })) {
                await instagramButton.click();
                console.log('   ✅ Clicked Instagram login button');

                // Wait for navigation
                await page.waitForTimeout(5000);

                const newUrl = page.url();
                console.log(`   New URL: ${newUrl}`);

                if (newUrl.includes('/login') || await page.content().then(c => c.includes('Log in with Instagram'))) {
                    console.log('   ❌ Still not logged in after clicking button');
                    console.log('   💡 Solution: Export cookies AFTER manually logging into Threads in browser\n');
                } else {
                    console.log('   ✅ LOGGED IN successfully after clicking button\n');
                }
            } else {
                console.log('   ⚠️ Button not found or not visible\n');
            }
        } catch (e) {
            console.log(`   ⚠️ Failed to click button: ${e.message}\n`);
        }
    } else if (currentUrl.includes('/login') || pageContent.includes('Log in with Instagram')) {
        console.log('   ❌ NOT LOGGED IN - Cookies are invalid or missing Instagram cookies');
        console.log('   💡 Solution: Export cookies while logged into Threads (include both .threads.net and .instagram.com domains)\n');
    } else {
        console.log('   ✅ LOGGED IN successfully\n');
    }

    const reporter = new TelegramReporter();

    try {
        // Run parallel scraping using multiple tabs
        const jobs = await scrapeThreadsParallel(context, reporter);

        console.log('\n' + '='.repeat(60));
        console.log('📊 RESULTS');
        console.log('='.repeat(60));
        console.log(`Total jobs found: ${jobs.length}\n`);

        if (jobs.length > 0) {
            jobs.forEach((job, i) => {
                console.log(`\n[${i + 1}] ${job.title}`);
                console.log(`    Company: ${job.company}`);
                console.log(`    Location: ${job.location}`);
                console.log(`    Posted: ${job.postedDate}`);
                console.log(`    Match Score: ${job.matchScore}/10`);
                console.log(`    Fresher: ${job.isFresher ? 'Yes' : 'No'}`);
                console.log(`    URL: ${job.url}`);
                console.log(`    Preview: ${job.preview}...`);
            });

            // Save to file
            const outputFile = path.join(__dirname, '../logs/test-threads-results.json');
            fs.writeFileSync(outputFile, JSON.stringify(jobs, null, 2));
            console.log(`\n✅ Results saved to: ${outputFile}`);
        } else {
            console.log('ℹ️ No jobs found. This could mean:');
            console.log('  - Cookies are invalid/expired');
            console.log('  - No matching posts found');
            console.log('  - Threads changed their data structure');
        }

    } catch (error) {
        console.error('\n❌ Test failed:', error);

        // Take screenshot for debugging
        const screenshotPath = path.join(__dirname, '../.tmp/screenshots/threads-error.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`📸 Screenshot saved to: ${screenshotPath}`);
    } finally {
        await browser.close();
    }
}

testThreads().catch(console.error);
