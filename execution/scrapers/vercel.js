/**
 * Vercel Analytics Scraper
 */

const CONFIG = require('../config');

async function scrapeVercel(page, reporter) {
    console.log('📈 Checking Vercel Analytics...');

    try {
        const targetUrl = CONFIG.vercelUrl || 'https://vercel.com/dashboard';

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

                // Heuristic: The dashboard usually shows Visitors, Views, Bounce in order.
                // Regex strategy: Find "Visitors" followed by newline and a number.

                let visitors = 'N/A';
                const visitMatch = cleanBody.match(/Visitors\s*\n\s*([\d,.]+)/i);
                if (visitMatch) visitors = visitMatch[1];

                const viewMatch = cleanBody.match(/Page Views\s*\n\s*([\d,.]+)/i);
                const pageViews = viewMatch ? viewMatch[1] : 'N/A';

                const bounceMatch = cleanBody.match(/Bounce Rate\s*\n\s*([\d,.]+%?)/i);
                const bounceRate = bounceMatch ? bounceMatch[1] : 'N/A';

                console.log(`  📊 Vercel Stats (24h): Visitors=${visitors}, Views=${pageViews}, Bounce=${bounceRate}`);

                if (visitors !== 'N/A' || pageViews !== 'N/A') {
                    await reporter.sendStatus(`📈 Vercel Analytics (24h):\n- Visitors: ${visitors}\n- Page Views: ${pageViews}\n- Bounce Rate: ${bounceRate}`);
                } else {
                    console.log('  ℹ️ Could not find metrics in text. (Might be loading or zero)');
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
