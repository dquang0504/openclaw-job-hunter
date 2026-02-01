/**
 * LinkedIn Posts Scraper - Authenticated Mode with Human-like Behavior
 * 
 * Features:
 * - Uses cookies for authenticated access
 * - Searches Posts with Latest filter
 * - Human-like interactions (reduced delays for reliability)
 */

const CONFIG = require('../config');
const {
    randomDelay,
    getRandomUserAgent,
    applyStealthSettings
} = require('../lib/stealth');

// LinkedIn Content Search URL - Posts filter, Latest sort
const LINKEDIN_SEARCH_URL = 'https://www.linkedin.com/search/results/content/';

// LinkedIn-specific keywords
const LINKEDIN_KEYWORDS = [
    'remote intern golang',
    'fresher golang',
    'entry level golang'
];

/**
 * Build LinkedIn Posts search URL
 */
function buildSearchUrl(keyword) {
    const params = new URLSearchParams({
        keywords: keyword,
        sortBy: '"date_posted"',  // Latest
        origin: 'FACETED_SEARCH'
    });
    return `${LINKEDIN_SEARCH_URL}?${params.toString()}`;
}

/**
 * Scrape LinkedIn Posts with human-like behavior
 */
async function scrapeLinkedIn(page, reporter) {
    console.log('💼 Searching LinkedIn Posts (Authenticated)...');
    console.log('  🔐 Using cookies for login');
    console.log('  📅 Filter: Posts + Latest');

    const jobs = [];

    // Apply stealth settings
    await applyStealthSettings(page);

    for (const keyword of LINKEDIN_KEYWORDS) {
        try {
            console.log(`\n  🔍 Searching: "${keyword}"`);

            // Navigate to search
            const searchUrl = buildSearchUrl(keyword);
            await page.goto(searchUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            // Short delay after navigation
            await randomDelay(2000, 3000);

            // Check if logged in
            const profileIcon = await page.locator('.global-nav__me, .feed-identity-module').count();
            if (profileIcon === 0) {
                console.log('  ⚠️ Not logged in - cookies may be expired');
                await reporter.sendStatus('⚠️ LinkedIn cookies expired - please update');
                continue;
            }

            console.log('  ✅ Logged in successfully');

            // Wait for content
            await page.waitForSelector('.feed-shared-update-v2, .update-components-actor, [data-urn]', {
                timeout: 10000
            }).catch(() => { });

            // Simple scroll to load content
            await page.evaluate(() => window.scrollBy(0, 400));
            await randomDelay(1000, 1500);
            await page.evaluate(() => window.scrollBy(0, 300));
            await randomDelay(500, 1000);

            // Find post cards
            const postCards = await page.locator('.feed-shared-update-v2, [data-urn*="update"]').all();
            console.log(`  📦 Found ${postCards.length} posts`);

            // Process posts
            for (let i = 0; i < Math.min(postCards.length, 8); i++) {
                const post = postCards[i];

                try {
                    // Get all text content from post
                    let postText = await post.textContent().catch(() => '');

                    if (!postText || postText.trim().length < 50) continue;
                    postText = postText.trim().slice(0, 500);

                    // Check for job-related content
                    const textLower = postText.toLowerCase();
                    const isJobPost = /\b(hiring|job|opening|position|looking for|developer|engineer|remote|we need|đang tuyển|intern|fresher|entry level)\b/i.test(textLower);

                    if (!isJobPost) continue;

                    // Extract author
                    let author = await post.locator('.update-components-actor__name span').first().textContent().catch(() => null);
                    if (!author) {
                        author = await post.locator('a[href*="/in/"]').first().textContent().catch(() => 'LinkedIn User');
                    }

                    // Get post URL
                    let postUrl = await post.locator('a[href*="/posts/"]').first().getAttribute('href').catch(() => null);
                    if (!postUrl) {
                        postUrl = await post.locator('a[href*="/feed/update/"]').first().getAttribute('href').catch(() => 'https://linkedin.com/feed');
                    }

                    // Build job object
                    const job = {
                        title: postText.slice(0, 100) + '...',
                        description: postText.slice(0, 300),
                        company: author?.trim()?.slice(0, 50) || 'LinkedIn User',
                        url: postUrl?.startsWith('http') ? postUrl : `https://linkedin.com${postUrl}`,
                        location: 'Remote/Global',
                        source: 'LinkedIn (Posts)',
                        techStack: 'Go/Golang',
                        postedDate: new Date().toLocaleDateString('vi-VN')
                    };

                    // Calculate match score
                    const hasGolang = /\b(golang|go\s*developer|go\s*backend|go\s*engineer)\b/i.test(textLower);
                    const hasHiring = /\b(hiring|job|opening|position|looking for|we need)\b/i.test(textLower);

                    job.matchScore = 5;
                    if (hasGolang) job.matchScore += 3;
                    if (hasHiring) job.matchScore += 2;

                    if (!CONFIG.excludeRegex?.test(textLower)) {
                        jobs.push(job);
                        console.log(`    ✅ [${job.matchScore}] ${job.company.slice(0, 25)} - ${job.title.slice(0, 40)}...`);
                    }
                } catch (e) {
                    // Skip malformed posts
                }
            }

            // Short delay between searches
            await randomDelay(2000, 3000);

        } catch (error) {
            console.error(`  ❌ Error searching "${keyword}":`, error.message);
        }
    }

    // Remove duplicates
    const uniqueJobs = [...new Map(jobs.map(j => [j.url, j])).values()];
    console.log(`\n  📊 LinkedIn Posts: Found ${uniqueJobs.length} unique job-related posts`);

    return uniqueJobs;
}

/**
 * Create LinkedIn context with cookies
 */
async function createLinkedInContext(browser) {
    const userAgent = getRandomUserAgent();
    console.log(`  🎭 Using User-Agent: ${userAgent.slice(0, 50)}...`);

    const context = await browser.newContext({
        userAgent: userAgent,
        viewport: {
            width: 1366 + Math.floor(Math.random() * 200),
            height: 768 + Math.floor(Math.random() * 100)
        },
        locale: 'en-US',
        timezoneId: 'Asia/Ho_Chi_Minh',
        screen: { width: 1920, height: 1080 },
        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8'
        }
    });

    return context;
}

module.exports = { scrapeLinkedIn, createLinkedInContext };
