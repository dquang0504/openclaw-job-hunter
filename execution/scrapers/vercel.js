/**
 * Vercel Analytics Scraper
 */

const CONFIG = require('../config');
const ScreenshotDebugger = require('../lib/screenshot');

const fs = require('fs');

async function scrapeVercel(page, reporter) {
    console.log('📈 Checking Vercel Analytics...');
    const screenshotDebugger = new ScreenshotDebugger(reporter);

    try {
        const preVisitUrl = 'https://vercel.com/dquang0504s-projects/my-portfolio/deployments';
        const targetUrl = 'https://vercel.com/dquang0504s-projects/my-portfolio/analytics?period=24h';

        // Load Cache
        let cachedStats = {};
        if (fs.existsSync(CONFIG.paths.vercelCache)) {
            try {
                cachedStats = JSON.parse(fs.readFileSync(CONFIG.paths.vercelCache, 'utf-8'));
            } catch (e) {
                console.warn('  ⚠️ Failed to parse Vercel cache');
            }
        }

        // 1. Visit Deployments page first (Warm up)
        console.log(`  🚀 Pre-visiting: ${preVisitUrl}`);
        await page.goto(preVisitUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Wait for DOM content loaded and hydration
        try {
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(2000);
        } catch (e) { }

        // 2. Click the Analytics link
        console.log(`  👉 Clicking Analytics link`);
        await page.click('a[data-testid="sub-menu-link/analytics"]');

        // Wait for hydration (reduced from 3s to 2s)
        try {
            await page.waitForTimeout(2000);
            await page.waitForSelector('text=Visitors', { timeout: 10000 });

            // 3. Select 'Last 24 Hours' filter
            console.log(`  👉 Selecting 'Last 24 Hours' filter`);
            await page.click('input[data-testid="calendar/combobox-input"]');
            await page.waitForTimeout(1000); // Wait for dropdown to open
            await page.click('div[data-value="Last 24 Hours"]');
            await page.waitForTimeout(2000); // Wait for data to update
        } catch (e) {
            console.log(`  ⚠️ Failed to select 'Last 24 Hours' filter: ${e.message}`);
        }

        // Check login - wrap in try-catch to handle closed page/browser
        try {
            // Check if page is still open
            if (page.isClosed()) {
                console.log('  ❌ Page was closed. Skipping Vercel scraper.');
                return;
            }

            const isLoginPage = page.url().includes('login');
            let hasEmailInput = false;

            try {
                hasEmailInput = await page.locator('input[name="email"]').isVisible({ timeout: 2000 });
            } catch (e) {
                // isVisible() can throw if page is closed or navigated
                if (e.message.includes('closed')) {
                    console.log('  ❌ Page/browser was closed during login check. Skipping.');
                    return;
                }
                // Otherwise, assume no email input
                hasEmailInput = false;
            }

            if (isLoginPage || hasEmailInput) {
                console.log('  ❌ Not logged in to Vercel. Skipping.');
                return;
            }
        } catch (e) {
            console.log(`  ❌ Error checking login state: ${e.message}. Skipping.`);
            return;
        }

        console.log('  ✅ Access Vercel Dashboard/Analytics');

        if (targetUrl.includes('/analytics')) {
            let attempt = 0;
            const maxRetries = 3;
            let scrapeSuccess = false;

            while (attempt < maxRetries && !scrapeSuccess) {
                attempt++;
                try {
                    console.log(`  🔄 Attempt ${attempt}/${maxRetries} to scrape Vercel data...`);

                    if (attempt > 1) {
                        // Check if page is still open before reload
                        if (page.isClosed()) {
                            console.log('  ❌ Page closed during retry. Aborting.');
                            return;
                        }
                        await page.reload({ waitUntil: 'domcontentloaded' });
                        // Reduced from 5s to 3s
                        await page.waitForTimeout(3000);
                    }

                    // Debug: Dump Body Text to see what's actually rendered
                    const bodyText = await page.innerText('body');
                    const cleanBody = bodyText.replace(/\n+/g, '\n');

                    // console.log('--- BODY TEXT START ---');
                    // console.log(cleanBody.slice(0, 1000));
                    // console.log('--- BODY TEXT END ---');

                    // Heuristic: Parse sections based on headers visible in the screenshot/dashboard

                    // Helper to extract top item from a section
                    const extractTopItem = (text, header, stopHeader) => {
                        // Find text between header and stopHeader
                        const startIndex = text.indexOf(header);
                        if (startIndex === -1) return 'N/A';

                        let endIndex = -1;
                        if (stopHeader && stopHeader !== 'End') {
                            endIndex = text.indexOf(stopHeader, startIndex);
                        }

                        const substring = endIndex !== -1
                            ? text.slice(startIndex + header.length, endIndex)
                            : text.slice(startIndex + header.length);

                        // Split by lines and take the first non-header, non-empty line that looks like data
                        const lines = substring.split('\n')
                            .map(l => l.trim())
                            .filter(l => l.length > 0 && !['Routes', 'Hostnames', 'UTM Parameters', 'Browsers', 'Visitors', 'VISITORS', 'Page Views', 'Bounce Rate'].includes(l));

                        if (lines.length > 0) {
                            // Usually format is "ItemName Count" or "ItemName percentage"
                            // Try to grab top 3
                            return lines.slice(0, 3).join(', ');
                        }
                        return 'No data';
                    };

                    // 1. Basic Stats
                    let visitors = 'N/A';
                    const visitMatch = cleanBody.match(/Visitors\s*\n\s*([\d,.]+)/i);
                    if (visitMatch) visitors = visitMatch[1];

                    const viewMatch = cleanBody.match(/Page Views\s*\n\s*([\d,.]+)/i);
                    const pageViews = viewMatch ? viewMatch[1] : 'N/A';

                    const bounceMatch = cleanBody.match(/Bounce Rate\s*\n\s*([\d,.]+%?)/i);
                    const bounceRate = bounceMatch ? bounceMatch[1] : 'N/A';

                    // Check if critical data is missing (User defined error condition)
                    if (visitors === 'N/A') {
                        console.warn(`  ⚠️ Attempt ${attempt}: Visitors data is N/A (Load error?)`);
                        if (attempt === maxRetries) {
                            throw new Error('Visitors data remains N/A after retries');
                        }
                        continue; // Retry
                    }

                    // 2. Advanced Stats (Heuristic parsing)
                    const topPages = extractTopItem(cleanBody, 'Pages', 'Referrers');
                    const referrers = extractTopItem(cleanBody, 'Referrers', 'Countries');
                    const countries = extractTopItem(cleanBody, 'Countries', 'Devices');
                    const devices = extractTopItem(cleanBody, 'Devices', 'Operating Systems');
                    const os = extractTopItem(cleanBody, 'Operating Systems', 'End');

                    const currentStats = {
                        visitors,
                        pageViews,
                        bounceRate,
                        topPages,
                        referrers,
                        countries,
                        devices,
                        os
                    };

                    console.log('  📊 Current Vercel Stats:', JSON.stringify(currentStats, null, 2));

                    // Compare with Cache
                    const isDifferent = JSON.stringify(currentStats) !== JSON.stringify(cachedStats);

                    if (visitors !== 'N/A' || pageViews !== 'N/A') {
                        if (isDifferent) {
                            console.log('  🔔 Stats changed. Sending notification.');
                            const message = `📈 *Vercel Analytics Report* (24h)
👥 *Traffic*:
• Visitors: ${visitors}
• Views: ${pageViews}
• Bounce: ${bounceRate}

📄 *Top Pages*:
${topPages.split(', ').map(i => `• ${i}`).join('\n')}

🌍 *Locations*:
${countries.split(', ').map(i => `• ${i}`).join('\n')}

📱 *Tech*:
• Devices: ${devices}
• OS: ${os}
• Referrers: ${referrers}`;

                            await reporter.sendStatus(message);

                            // Update Cache
                            fs.writeFileSync(CONFIG.paths.vercelCache, JSON.stringify(currentStats, null, 2));
                        } else {
                            console.log('  Draws 💤 Stats identical to cache. Skipping notification.');
                        }
                    }

                    scrapeSuccess = true; // Mark as success to exit loop

                } catch (e) {
                    console.log(`  ⚠️ Attempt ${attempt} failed: ${e.message}`);
                    if (attempt === maxRetries) {
                        console.error('  ❌ All retries failed for Vercel Scraper.');
                        await screenshotDebugger.capture(page, 'vercel_retry_failed');
                        await reporter.sendError(`⚠️ Vercel Scraper Failed: ${e.message}`);
                    }
                }
            }
        }

    } catch (e) {
        console.error(`  ❌ Vercel Scrape Error: ${e.message}`);
        if (e.message.includes('timeout') || e.message.includes('Timed out')) {
            await screenshotDebugger.capture(page, 'vercel_timeout');
        } else {
            await screenshotDebugger.capture(page, 'vercel_error');
        }
    }
}

module.exports = { scrapeVercel };
