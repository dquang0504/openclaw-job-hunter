/**
 * X (Twitter) Scraper
 * Returns raw tweet data - AI validation done in main.js
 */

const CONFIG = require('../config');
const { randomDelay, humanScroll } = require('../lib/stealth');

/**
 * Helper: Normalize text to handle fancy fonts and accents
 */
const normalizeText = (text) => (text || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Scrape jobs from X (Twitter)
 * Returns RAW jobs - AI validation done centrally in main.js
 */
async function scrapeTwitter(page, reporter) {
    console.log('🐦 Searching X (Twitter)...');

    const jobs = [];

    // Build search query
    const keywordPart = CONFIG.keywords.slice(0, 3).map(k => `"${k}"`).join(' OR ');
    const searchQuery = `(${keywordPart}) (job OR hiring) (fresher OR junior OR intern) -senior -5년`;
    console.log(`  🔍 Query: ${searchQuery.slice(0, 60)}...`);

    try {
        await page.goto(`https://x.com/search?q=${encodeURIComponent(searchQuery)}&f=live`,
            { waitUntil: 'domcontentloaded', timeout: 60000 });
        await randomDelay(1000, 2000);

        await page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 }).catch(() => { });

        // Check for login wall
        if (await page.locator('[data-testid="LoginForm"]').count() > 0) {
            console.log('  ⚠️ Twitter requires login, skipping...');
            await reporter.sendStatus('⚠️ X requires login - skipping (ensure cookies are valid)');
            return jobs;
        }

        await humanScroll(page);

        const tweetElements = await page.locator('[data-testid="tweet"]').all();
        console.log(`  📦 Found ${tweetElements.length} tweets`);

        // Collect raw tweet data - NO AI validation here
        for (let i = 0; i < Math.min(tweetElements.length, 30); i++) {
            try {
                const tweet = tweetElements[i];
                const text = await tweet.locator('[data-testid="tweetText"]').textContent().catch(() => null);
                if (!text || text.trim().length < 20) continue;

                const authorHandle = await tweet.locator('[data-testid="User-Name"] a').first().getAttribute('href').catch(() => null);
                const tweetLink = await tweet.locator('a[href*="/status/"]').first().getAttribute('href').catch(() => null);
                const timeEl = await tweet.locator('time').first();
                const dateTime = await timeEl.getAttribute('datetime').catch(() => null);

                // Build raw job object
                const job = {
                    title: text?.slice(0, 100)?.trim() + '...',
                    description: text,
                    company: authorHandle?.replace('/', '') || 'Twitter Post',
                    url: tweetLink ? `https://x.com${tweetLink}` : 'https://x.com',
                    location: 'Remote/Global',
                    source: 'X (Twitter)',
                    techStack: 'Go/Golang',
                    postedDate: dateTime ? new Date(dateTime).toISOString().split('T')[0] : 'N/A',
                    matchScore: 5  // Default, will be overwritten by AI
                };

                // Basic filter - only include if has job-related keywords
                // NORMALIZE CHECK
                const textNorm = normalizeText(text);

                if (/\b(hiring|job|opening|developer|engineer|position|remote|golang|go backend)\b/i.test(textNorm)) {
                    jobs.push(job);
                    console.log(`    📝 ${job.title.slice(0, 40)}...`);
                }
            } catch (e) {
                // Skip malformed
            }
        }

        console.log(`  📊 Collected ${jobs.length} tweets for unified AI validation`);

    } catch (error) {
        console.error('Error searching Twitter:', error.message);
        await reporter.sendError(`Twitter search failed: ${error.message}`);
    }

    return jobs;
}

module.exports = { scrapeTwitter };
