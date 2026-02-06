/**
 * Vercel Analytics Scraper
 */

const CONFIG = require('../config');

const fs = require('fs');

async function scrapeVercel(page, reporter) {
    console.log('📈 Checking Vercel Analytics...');

    try {
        const targetUrl = CONFIG.vercelUrl || 'https://vercel.com/dashboard';

        // Load Cache
        let cachedStats = {};
        if (fs.existsSync(CONFIG.paths.vercelCache)) {
            try {
                cachedStats = JSON.parse(fs.readFileSync(CONFIG.paths.vercelCache, 'utf-8'));
            } catch (e) {
                console.warn('  ⚠️ Failed to parse Vercel cache');
            }
        }

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Wait for hydration
        try {
            await page.waitForTimeout(3000); // Give React time to hydrate
            await page.waitForSelector('text=Visitors', { timeout: 10000 });
        } catch (e) { }

        // Check login
        if (page.url().includes('login') || await page.locator('input[name="email"]').isVisible()) {
            console.log('  ❌ Not logged in to Vercel. Skipping.');
            return;
        }

        console.log('  ✅ Access Vercel Dashboard/Analytics');

        if (targetUrl.includes('/analytics')) {
            try {
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

                // 2. Advanced Stats (Heuristic parsing)
                // Note: The text dump order depends on DOM flow. We look for keywords.

                // Pages (under "Pages" tab)
                // Use robust regex to find the section if simple split fails, but simple split is safer for now
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

                // Check if we have ANY valid data
                const hasValidData =
                    visitors !== 'N/A' ||
                    pageViews !== 'N/A' ||
                    (topPages !== 'N/A' && topPages !== 'No data') ||
                    (countries !== 'N/A' && countries !== 'No data') ||
                    (devices !== 'N/A' && devices !== 'No data');

                if (hasValidData) {
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
                } else {
                    console.log('  ℹ️ Could not find meaningful analytics data (All fields N/A or No data).');
                }

            } catch (e) {
                console.log(`  ⚠️ Could not scrape analytics data: ${e.message}`);
                const title = await page.title();
                console.log(`  Page Title: ${title}`);
            }
        }

    } catch (e) {
        console.error(`  ❌ Vercel Scrape Error: ${e.message}`);
    }
}

module.exports = { scrapeVercel };
