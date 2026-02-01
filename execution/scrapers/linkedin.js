/**
 * LinkedIn Posts Scraper - Authenticated Mode with Human-like Behavior
 * 
 * Features:
 * - Uses cookies for authenticated access
 * - Searches Posts (not Jobs) with Latest filter
 * - Human-like interactions: smooth scroll, mouse jiggle, thinking delays
 * - Stealth measures to avoid detection
 */

const CONFIG = require('../config');
const {
    randomDelay,
    thinkingDelay,
    smoothScroll,
    mouseJiggle,
    humanType,
    getRandomUserAgent,
    applyStealthSettings
} = require('../lib/stealth');
const { calculateMatchScore } = require('../lib/filters');

// LinkedIn Content Search URL - Posts filter, Latest sort
const LINKEDIN_SEARCH_URL = 'https://www.linkedin.com/search/results/content/';

/**
 * Build LinkedIn Posts search URL
 * sortBy=date_posted = Latest
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

    // Search keywords for Golang jobs
    const searchKeywords = [
        'golang developer hiring',
        'go backend developer job',
        'golang remote job'
    ];

    for (const keyword of searchKeywords) {
        try {
            console.log(`\n  🔍 Searching: "${keyword}"`);

            // === HUMAN-LIKE: Navigate with natural delay ===
            const searchUrl = buildSearchUrl(keyword);
            await page.goto(searchUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            // === HUMAN-LIKE: Thinking delay (2-5s) ===
            await thinkingDelay();

            // === HUMAN-LIKE: Move mouse naturally ===
            await mouseJiggle(page);

            // Check if still logged in
            const profileIcon = await page.locator('.global-nav__me, .feed-identity-module').count();
            if (profileIcon === 0) {
                console.log('  ⚠️ Not logged in - cookies may be expired');
                await reporter.sendStatus('⚠️ LinkedIn cookies expired - please update');
                continue;
            }

            console.log('  ✅ Logged in successfully');

            // === HUMAN-LIKE: Wait for content to load naturally ===
            await page.waitForSelector('.search-results__list, .feed-shared-update-v2, .update-components-actor', {
                timeout: 15000
            }).catch(() => { });

            // === HUMAN-LIKE: Scroll like reading ===
            await smoothScroll(page, 300);
            await randomDelay(1000, 2000);

            await mouseJiggle(page);

            await smoothScroll(page, 400);
            await randomDelay(800, 1500);

            // === HUMAN-LIKE: Another scroll with pause ===
            await thinkingDelay();
            await smoothScroll(page, 350);

            // Find post cards
            const postCards = await page.locator('.feed-shared-update-v2, .update-components-actor__container, [data-urn*="update"]').all();
            console.log(`  📦 Found ${postCards.length} posts`);

            // Process posts with delays
            for (let i = 0; i < Math.min(postCards.length, 8); i++) {
                const post = postCards[i];

                try {
                    // === HUMAN-LIKE: Small delay between reading each post ===
                    await randomDelay(200, 500);

                    // Try multiple selectors to extract post text
                    let postText = null;
                    const textSelectors = [
                        '.feed-shared-update-v2__description',
                        '.update-components-text',
                        '.break-words span',
                        'span[dir="ltr"]',
                        '.feed-shared-text'
                    ];

                    for (const sel of textSelectors) {
                        postText = await post.locator(sel).first().textContent().catch(() => null);
                        if (postText && postText.trim().length > 30) break;
                    }

                    // Fallback: get all visible text
                    if (!postText || postText.trim().length < 30) {
                        postText = await post.textContent().catch(() => '');
                    }

                    if (!postText || postText.trim().length < 30) continue;
                    postText = postText.trim().slice(0, 500);

                    // Check for job-related content
                    const textLower = postText.toLowerCase();
                    const isJobPost = /\b(hiring|job|opening|position|looking for|developer|engineer|remote|work from home|we need|đang tuyển)\b/i.test(textLower);

                    if (!isJobPost) continue;

                    // Extract author
                    let author = await post.locator('.update-components-actor__name span, .feed-shared-actor__name').first().textContent().catch(() => null);
                    if (!author) {
                        author = await post.locator('a[href*="/in/"]').first().textContent().catch(() => 'LinkedIn User');
                    }

                    // Get post URL - try multiple patterns
                    let postUrl = null;
                    const urlSelectors = [
                        'a[href*="/posts/"]',
                        'a[href*="/feed/update/"]',
                        '.update-components-actor__sub-description a'
                    ];
                    for (const sel of urlSelectors) {
                        postUrl = await post.locator(sel).first().getAttribute('href').catch(() => null);
                        if (postUrl) break;
                    }

                    if (!postUrl) {
                        postUrl = 'https://linkedin.com/feed';
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

            // === HUMAN-LIKE: Delay between searches ===
            await randomDelay(3000, 6000);
            await mouseJiggle(page);

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
