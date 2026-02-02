/**
 * Vercel Analytics Scraper
 */

const CONFIG = require('../config');
const path = require('path');

async function scrapeVercel(page, reporter) {
    console.log('📈 Checking Vercel Analytics...');

    // Cookies are now loaded in job-search.js

    try {
        const targetUrl = CONFIG.vercelUrl || 'https://vercel.com/dashboard';

        // Relaxed wait condition: 'domcontentloaded' + manual wait
        // 'networkidle' is too flaky for heavy SPA like Vercel
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Wait for potential redirect or hydration
        try {
            // Wait for either dashboard element OR login input
            await page.waitForSelector('input[name="email"], h1, [data-testid="dashboard-title"], [data-testid="visitors-count"]', { timeout: 10000 });
        } catch (e) {
            // ignore timeout, just proceed to check logic
        }

        // Check if logged in
        if (page.url().includes('login') || await page.locator('input[name="email"]').isVisible()) {
            console.log('  ❌ Not logged in to Vercel (Redirected to Login). Skipping.');
            return;
        }

        console.log('  ✅ Access Vercel Dashboard/Analytics');

        // Scrape logic
        // If URL is analytics specific
        if (targetUrl.includes('/analytics')) {
            try {
                await page.waitForSelector('[data-testid="visitors-count"], span:has-text("Visitors")', { timeout: 10000 });

                const visitorEl = page.locator('span:has-text("Visitors") + span, p:has-text("Visitors") + p, [data-testid="visitors-count"]').first();
                const visitorCount = await visitorEl.innerText().catch(() => '0');

                console.log(`  📊 Vercel Traffic: ${visitorCount} visitors`);

                if (parseInt(visitorCount.replace(/,/g, '')) > 0) {
                    await reporter.sendStatus(`📈 Vercel Project Traffic: ${visitorCount} visitors in the last 24h.`);
                }
            } catch (e) {
                console.log('  ⚠️ Could not find visitor count element.');
            }
        } else {
            console.log('  ℹ️ Dashboard only. Set specific analytics URL in config for detailed stats.');
        }

    } catch (e) {
        console.error(`  ❌ Vercel Scrape Error: ${e.message}`);
    }
}

module.exports = { scrapeVercel };
