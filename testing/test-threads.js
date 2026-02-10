/**
 * Test Threads Scraper
 * Run: node testing/test-threads.js
 */

require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { scrapeThreads } = require('../execution/scrapers/threads');
const TelegramReporter = require('../execution/lib/telegram');

async function testThreads() {
    console.log('🧪 Testing Threads Scraper...\n');

    const browser = await chromium.launch({
        headless: false, // Show browser for debugging
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh'
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
            console.log(`🍪 Loaded ${cleanCookies.length} Threads cookies\n`);
        } catch (e) {
            console.warn(`⚠️ Failed to load cookies: ${e.message}\n`);
        }
    } else {
        console.warn('⚠️ No cookies file found. Scraper may not work without authentication.\n');
    }

    const page = await context.newPage();
    const reporter = new TelegramReporter();

    try {
        const jobs = await scrapeThreads(page, reporter);

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
