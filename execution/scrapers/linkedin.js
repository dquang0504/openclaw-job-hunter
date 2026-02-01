/**
 * LinkedIn Posts Scraper - Authenticated Mode
 * Simplified version with faster processing
 */

const CONFIG = require('../config');
const {
    randomDelay,
    getRandomUserAgent,
    applyStealthSettings
} = require('../lib/stealth');

const LINKEDIN_SEARCH_URL = 'https://www.linkedin.com/search/results/content/';

const LINKEDIN_KEYWORDS = [
    'remote intern golang',
    'fresher golang',
    'entry level golang'
];

function buildSearchUrl(keyword) {
    const params = new URLSearchParams({
        keywords: keyword,
        sortBy: '"date_posted"',
        origin: 'FACETED_SEARCH'
    });
    return `${LINKEDIN_SEARCH_URL}?${params.toString()}`;
}

async function scrapeLinkedIn(page, reporter) {
    console.log('💼 Searching LinkedIn Posts (Authenticated)...');
    console.log('  🔐 Using cookies for login');
    console.log('  📅 Filter: Posts + Latest');

    const jobs = [];
    await applyStealthSettings(page);

    for (const keyword of LINKEDIN_KEYWORDS) {
        if (page.isClosed()) {
            console.log('  ⚠️ Browser closed, stopping search');
            break;
        }

        try {
            console.log(`\n  🔍 Searching: "${keyword}"`);

            const searchUrl = buildSearchUrl(keyword);
            await page.goto(searchUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });

            await randomDelay(1500, 2000);

            // Quick login check
            const isLoggedIn = await page.locator('.global-nav__me').count() > 0;
            if (!isLoggedIn) {
                console.log('  ⚠️ Not logged in');
                continue;
            }
            console.log('  ✅ Logged in successfully');

            // Wait for posts
            await page.waitForTimeout(2000);

            // Get posts with simple textContent
            const posts = await page.locator('.feed-shared-update-v2').all();
            console.log(`  📦 Found ${posts.length} posts`);

            // Process max 5 posts quickly
            for (let i = 0; i < Math.min(posts.length, 5); i++) {
                try {
                    // Try innerText first, then specific selectors
                    let postText = await posts[i].innerText({ timeout: 3000 }).catch(() => null);

                    // If innerText is mostly whitespace, try specific content selectors
                    if (!postText || postText.replace(/\s/g, '').length < 30) {
                        // Try .feed-shared-text or .break-words
                        const textEl = await posts[i].locator('.feed-shared-text, .break-words, [dir="ltr"]').first();
                        postText = await textEl.innerText({ timeout: 2000 }).catch(() => null);
                    }

                    if (!postText || postText.replace(/\s/g, '').length < 30) continue;

                    const text = postText.toLowerCase().slice(0, 800);

                    // Check regex: job keywords + golang
                    const jobMatch = /\b(fresher|freshers|intern|internship|entry\s*level|junior|hiring|job|graduate|software\s*developer)\b/i.test(text);
                    const goMatch = /\b(golang|go\s*developer|go\s*backend|node\.?js)\b/i.test(text);

                    // Debug: show first 80 chars of each post
                    console.log(`    [${i}] "${text.slice(0, 80).replace(/\n/g, ' ')}..." job=${jobMatch} go=${goMatch}`);

                    if (!jobMatch || !goMatch) continue;

                    // Extract author name (simplified)
                    const authorMatch = postText.match(/^([A-Za-z\s]{5,30})/);
                    const author = authorMatch ? authorMatch[1].trim() : 'LinkedIn User';

                    jobs.push({
                        title: text.slice(0, 100) + '...',
                        description: text.slice(0, 300),
                        company: author.slice(0, 40),
                        url: 'https://linkedin.com/feed',
                        location: 'Remote/Global',
                        source: 'LinkedIn (Posts)',
                        techStack: 'Golang',
                        postedDate: new Date().toLocaleDateString('vi-VN'),
                        matchScore: 8
                    });

                    console.log(`    ✅ [8] ${author.slice(0, 25)} - ${text.slice(0, 40)}...`);
                } catch (e) {
                    // Skip
                }
            }

            await randomDelay(800, 1200);

        } catch (error) {
            console.error(`  ❌ Error: ${error.message.slice(0, 50)}`);
        }
    }

    const uniqueJobs = [...new Map(jobs.map(j => [j.description, j])).values()];
    console.log(`\n  📊 LinkedIn Posts: Found ${uniqueJobs.length} unique job-related posts`);

    return uniqueJobs;
}

async function createLinkedInContext(browser) {
    const userAgent = getRandomUserAgent();
    console.log(`  🎭 Using User-Agent: ${userAgent.slice(0, 50)}...`);

    return await browser.newContext({
        userAgent: userAgent,
        viewport: { width: 1366, height: 768 },
        locale: 'en-US',
        timezoneId: 'Asia/Ho_Chi_Minh'
    });
}

module.exports = { scrapeLinkedIn, createLinkedInContext };
