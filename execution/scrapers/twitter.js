/**
 * X (Twitter) Scraper
 */

const CONFIG = require('../config');
const { randomDelay, humanScroll } = require('../lib/stealth');
const { batchValidateJobsWithAI } = require('../lib/ai-filter');

/**
 * Scrape jobs from X (Twitter)
 * @param {import('playwright').Page} page 
 * @param {import('../lib/telegram')} reporter 
 */
async function scrapeTwitter(page, reporter) {
    console.log('🐦 Searching X (Twitter)...');

    const jobs = [];

    // Build search query from CONFIG keywords
    const keywordPart = CONFIG.keywords.slice(0, 3).map(k => `"${k}"`).join(' OR ');
    const searchQuery = `(${keywordPart}) (job OR hiring) (fresher OR junior OR intern) -senior -5년`;
    console.log(`  🔍 Query: ${searchQuery.slice(0, 60)}...`);

    try {
        await page.goto(`https://x.com/search?q=${encodeURIComponent(searchQuery)}&f=live`,
            { waitUntil: 'domcontentloaded', timeout: 20000 });
        await randomDelay(1000, 2000);

        // Wait for tweets to appear
        await page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 }).catch(() => { });

        // Check for login wall
        if (await page.locator('[data-testid="LoginForm"]').count() > 0) {
            console.log('⚠️ Twitter requires login, skipping...');
            await reporter.sendStatus('⚠️ X requires login - skipping (ensure cookies are valid)');
            return jobs;
        }

        await humanScroll(page);

        const tweetElements = await page.locator('[data-testid="tweet"]').all();
        console.log(`  📦 Found ${tweetElements.length} tweets`);

        // STEP 1: Collect all tweet data first
        const tweetData = [];
        for (let i = 0; i < Math.min(tweetElements.length, 10); i++) {
            try {
                const tweet = tweetElements[i];
                const text = await tweet.locator('[data-testid="tweetText"]').textContent().catch(() => null);
                if (!text) continue;

                const authorHandle = await tweet.locator('[data-testid="User-Name"] a').first().getAttribute('href').catch(() => null);
                const tweetLink = await tweet.locator('a[href*="/status/"]').first().getAttribute('href').catch(() => null);
                const timeEl = await tweet.locator('time').first();
                const dateTime = await timeEl.getAttribute('datetime').catch(() => null);

                tweetData.push({
                    id: i,
                    text,
                    authorHandle,
                    tweetLink,
                    postedDate: dateTime ? new Date(dateTime).toLocaleDateString('vi-VN') : 'N/A'
                });
            } catch (e) {
                // Skip malformed
            }
        }

        console.log(`  📝 Collected ${tweetData.length} tweets for validation`);

        // STEP 2: Batch validate with AI (SINGLE API CALL!)
        const validationResults = await batchValidateJobsWithAI(tweetData);

        // STEP 3: Build job list from validated tweets
        for (const t of tweetData) {
            const validation = validationResults.get(t.id) || { isJob: false, score: 0 };

            if (!validation.isJob || validation.score < 6) {
                console.log(`    ❌ [${validation.score}] ${t.text.slice(0, 35)}...`);
                continue;
            }

            const job = {
                title: t.text?.slice(0, 100)?.trim() + '...',
                company: t.authorHandle?.replace('/', '') || 'Twitter Post',
                url: t.tweetLink ? `https://x.com${t.tweetLink}` : 'https://x.com',
                description: t.text,
                location: 'Remote/Global',
                source: 'X (Twitter)',
                techStack: 'Go/Golang',
                postedDate: t.postedDate,
                matchScore: validation.score,
                aiReason: validation.reason
            };

            jobs.push(job);
            console.log(`    ✅ [${validation.score}/10] ${job.title.slice(0, 35)}...`);

            if (jobs.length >= 5) break;
        }
    } catch (error) {
        console.error('Error searching Twitter:', error.message);
        await reporter.sendError(`Twitter search failed: ${error.message}`);
    }

    return jobs;
}

module.exports = { scrapeTwitter };
