/**
 * LinkedIn Posts Scraper - Guest Mode Only (No Login/No Cookies)
 * 
 * OPTIMIZED: Uses Posts search instead of Jobs filter for broader coverage
 * 
 * Features:
 * - Searches LinkedIn Posts (not Jobs) for hiring-related content
 * - Filters: Latest match, Past 24 hours
 * - No login required - eliminates account ban risk
 * - Advanced stealth measures for anti-detection
 */

const CONFIG = require('../config');
const {
    randomDelay,
    thinkingDelay,
    smoothScroll,
    mouseJiggle,
    getRandomUserAgent,
    applyStealthSettings
} = require('../lib/stealth');
const { calculateMatchScore } = require('../lib/filters');

// LinkedIn Posts Search URL (not Jobs)
// sortBy=date_posted = Latest match
// datePosted="past-24h" = Past 24 hours
const LINKEDIN_POSTS_SEARCH_URL = 'https://www.linkedin.com/search/results/content/';

/**
 * Build LinkedIn Posts search URL with parameters
 */
function buildLinkedInPostsUrl(keyword) {
    const params = new URLSearchParams({
        keywords: `${keyword} hiring`,
        datePosted: '"past-24h"',
        sortBy: '"date_posted"',  // Latest match
        origin: 'FACETED_SEARCH'
    });
    return `${LINKEDIN_POSTS_SEARCH_URL}?${params.toString()}`;
}

/**
 * Alternative: LinkedIn Feed search (public, no login)
 */
function buildLinkedInGuestSearchUrl(keyword) {
    // Guest-friendly search - uses the public feed search
    return `https://www.linkedin.com/feed/hashtag/?keywords=${encodeURIComponent(keyword)}hiring`;
}

/**
 * Scrape posts from LinkedIn in Guest Mode
 * Uses Posts search for broader job-related content coverage
 */
async function scrapeLinkedIn(page, reporter) {
    console.log('💼 Searching LinkedIn Posts (Guest Mode)...');
    console.log('  🔒 No login required - searching public posts');
    console.log('  📅 Filter: Latest match, Past 24 hours');

    const jobs = [];

    // Apply stealth settings
    await applyStealthSettings(page);

    // Search keywords - combined with "hiring" for better results
    const searchKeywords = [
        'golang developer',
        'go backend',
        'golang fresher',
        'golang remote'
    ];

    for (const keyword of searchKeywords) {
        try {
            // Try Posts search first (may require login wall bypass)
            const searchUrl = buildLinkedInPostsUrl(keyword);
            console.log(`  🔍 Searching posts: "${keyword} hiring"`);

            await page.goto(searchUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            // Human-like thinking delay (2-7 seconds)
            await thinkingDelay();
            await mouseJiggle(page);

            // Check for auth wall - if hit, try guest hashtag search
            const hasAuthWall = await page.locator('.authwall-join-form, [data-tracking-control-name="public_jobs_nav-header-join"], .join-form').count();

            if (hasAuthWall > 0) {
                console.log('  ⚠️ Auth wall detected, trying guest hashtag search...');

                // Fallback to hashtag search (more guest-friendly)
                const hashtagUrl = `https://www.linkedin.com/feed/hashtag/${encodeURIComponent(keyword.replace(/\s+/g, ''))}`;
                await page.goto(hashtagUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: 20000
                }).catch(() => { });

                await thinkingDelay();
            }

            // Smooth scroll to load more content
            await smoothScroll(page, 800);
            await thinkingDelay();
            await smoothScroll(page, 600);
            await mouseJiggle(page);

            // Extract posts - look for various post card selectors
            const postSelectors = [
                '.feed-shared-update-v2',   // Feed posts
                '.update-components-text',   // Post text
                '[data-urn]',               // Any element with URN
                '.occludable-update',        // Occludable posts
                'article',                   // Generic articles
                '.scaffold-finite-scroll__content > div',  // Scroll content
                '.search-results__list > div'  // Search results
            ];

            let posts = [];
            for (const selector of postSelectors) {
                posts = await page.locator(selector).all();
                if (posts.length > 0) {
                    console.log(`  📦 Found ${posts.length} posts with selector: ${selector.slice(0, 30)}`);
                    break;
                }
            }

            if (posts.length === 0) {
                // Try to get any visible text content
                const bodyText = await page.locator('body').textContent().catch(() => '');
                const hasJobContent = /hiring|job|golang|developer/i.test(bodyText);
                console.log(`  📝 Page has job-related content: ${hasJobContent}`);
                continue;
            }

            for (const post of posts.slice(0, 6)) { // Limit posts
                try {
                    // Extract post content
                    let postText = await post.locator('.update-components-text, .feed-shared-text, span[dir="ltr"]').first().textContent().catch(() => null);

                    if (!postText) {
                        postText = await post.textContent().catch(() => '');
                    }

                    if (!postText || postText.trim().length < 20) continue;

                    // Check for job-related keywords
                    const textLower = postText.toLowerCase();
                    const isHiringPost = /\b(hiring|job|opening|position|looking for|we need|remote|developer|engineer|golang|go backend)\b/i.test(textLower);

                    if (!isHiringPost) continue;

                    // Extract author/company
                    let author = await post.locator('.update-components-actor__name, .feed-shared-actor__name, a[data-tracking-control-name]').first().textContent().catch(() => 'LinkedIn Post');

                    // Get post link
                    let postUrl = await post.locator('a[href*="/posts/"], a[href*="/feed/update/"]').first().getAttribute('href').catch(() => null);
                    if (!postUrl) {
                        postUrl = await post.locator('a').first().getAttribute('href').catch(() => 'https://linkedin.com');
                    }

                    const job = {
                        title: postText.trim().slice(0, 100) + '...',
                        company: author?.trim()?.slice(0, 50) || 'LinkedIn Post',
                        url: postUrl?.startsWith('http') ? postUrl : `https://linkedin.com${postUrl}`,
                        description: postText.trim().slice(0, 300),
                        location: 'Remote/Global',
                        source: 'LinkedIn (Posts)',
                        techStack: 'Go/Golang',
                        postedDate: new Date().toLocaleDateString('vi-VN')  // Past 24h filter
                    };

                    // Score the job
                    const jobText = `${job.title} ${job.company} ${job.description}`.toLowerCase();
                    if (!CONFIG.excludeRegex.test(jobText)) {
                        job.matchScore = calculateMatchScore(job);

                        // Boost score for direct hiring mentions
                        if (/\b(we('re|\ are) hiring|hiring now|job opening)\b/i.test(jobText)) {
                            job.matchScore = Math.min(10, job.matchScore + 2);
                        }

                        jobs.push(job);
                        console.log(`    ✅ [${job.matchScore}] ${job.title.slice(0, 40)}...`);
                    }
                } catch (e) {
                    // Skip malformed posts
                }

                await randomDelay(100, 300);
            }

            await randomDelay(2000, 4000);

        } catch (error) {
            console.error(`  ❌ Error searching "${keyword}":`, error.message);
        }
    }

    // Remove duplicates
    const uniqueJobs = [...new Map(jobs.map(j => [j.url, j])).values()];
    console.log(`  📊 LinkedIn Posts: Found ${uniqueJobs.length} unique posts`);

    return uniqueJobs;
}

/**
 * Create a fresh browser context for LinkedIn (no persistence)
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
        storageState: undefined,  // Fresh guest identity
        screen: { width: 1920, height: 1080 },
        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8'
        }
    });

    return context;
}

module.exports = { scrapeLinkedIn, createLinkedInContext };
