/**
 * LinkedIn Jobs Scraper - Guest Mode Only (No Login/No Cookies)
 * 
 * Features:
 * - Uses public LinkedIn Guest Job Search endpoint
 * - No login required - eliminates account ban risk
 * - Advanced stealth measures for anti-detection
 * - User-Agent rotation
 * - Human mimicry (smooth scrolling, mouse jiggle, thinking delays)
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
const { calculateMatchScore, shouldIncludeJob } = require('../lib/filters');

// LinkedIn Guest Job Search URL template
// f_TPR=r86400 means jobs posted in last 24 hours
const LINKEDIN_GUEST_SEARCH_URL = 'https://www.linkedin.com/jobs/search';

/**
 * Build LinkedIn search URL with parameters
 */
function buildLinkedInUrl(keyword, location = 'Vietnam') {
    const params = new URLSearchParams({
        keywords: keyword,
        location: location,
        f_TPR: 'r86400',  // Last 24 hours
        position: 1,
        pageNum: 0
    });
    return `${LINKEDIN_GUEST_SEARCH_URL}?${params.toString()}`;
}

/**
 * Scrape jobs from LinkedIn in Guest Mode
 * @param {import('playwright').Page} page 
 * @param {import('../lib/telegram')} reporter 
 */
async function scrapeLinkedIn(page, reporter) {
    console.log('💼 Searching LinkedIn (Guest Mode)...');
    console.log('  🔒 No login required - using public guest pages');

    const jobs = [];

    // Apply stealth settings
    await applyStealthSettings(page);

    // Search keywords focused on Golang
    const searchKeywords = ['golang', 'go developer', 'golang developer'];
    const location = 'Vietnam';

    for (const keyword of searchKeywords) {
        try {
            const searchUrl = buildLinkedInUrl(keyword, location);
            console.log(`  🔍 Searching: "${keyword}" in ${location}`);

            // Navigate with random user agent already set in context
            await page.goto(searchUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            // Human-like thinking delay (2-7 seconds)
            await thinkingDelay();

            // Mouse jiggle for authenticity
            await mouseJiggle(page);

            // Check if we hit a login wall or CAPTCHA
            const loginWall = await page.locator('.authwall-join-form, [data-tracking-control-name="public_jobs_nav-header-join"]').count();
            if (loginWall > 0) {
                console.log('  ⚠️ LinkedIn auth wall detected, continuing with visible content...');
            }

            // Wait for job cards to load
            await page.waitForSelector('.jobs-search__results-list, .job-search-card, .base-card', {
                timeout: 15000
            }).catch(() => { });

            // Smooth scroll to load more content
            await smoothScroll(page, 800);
            await thinkingDelay();
            await smoothScroll(page, 600);

            // Mouse movement for realism
            await mouseJiggle(page);

            // Extract job listings from guest page
            // LinkedIn guest pages have different selectors than logged-in pages
            const jobCards = await page.locator('.base-card, .job-search-card, .jobs-search__results-list > li').all();
            console.log(`  📦 Found ${jobCards.length} job cards`);

            for (const card of jobCards.slice(0, 8)) { // Limit to avoid detection
                try {
                    // Guest page selectors - try multiple strategies
                    let title = await card.locator('.base-search-card__title, h3, .sr-only').first().textContent().catch(() => null);
                    let url = await card.locator('a').first().getAttribute('href').catch(() => null);
                    let company = await card.locator('.base-search-card__subtitle, h4, .hidden-nested-link').first().textContent().catch(() => 'Unknown');
                    let jobLocation = await card.locator('.job-search-card__location').first().textContent().catch(() => null);
                    let postedDate = await card.locator('time').first().getAttribute('datetime').catch(() => null);

                    // Clean up and validate
                    if (!title || title.trim().length < 5) continue;
                    title = title.trim();

                    const job = {
                        title: title.slice(0, 100),
                        company: company?.trim() || 'Unknown',
                        url: url || 'https://linkedin.com/jobs',
                        location: jobLocation?.trim() || 'Vietnam',
                        source: 'LinkedIn (Guest)',
                        techStack: 'Go/Golang',
                        postedDate: postedDate ? new Date(postedDate).toLocaleDateString('vi-VN') : 'N/A'
                    };

                    // Broader matching - include any dev/engineer jobs
                    const jobText = `${job.title} ${job.company}`.toLowerCase();
                    const hasGoKeyword = jobText.includes('go') || jobText.includes('golang') || jobText.includes('backend');
                    const isDevJob = jobText.includes('developer') || jobText.includes('engineer') || jobText.includes('software');

                    if ((hasGoKeyword || isDevJob) && !CONFIG.excludeRegex.test(jobText)) {
                        job.matchScore = calculateMatchScore(job);
                        jobs.push(job);
                        console.log(`    ✅ ${job.title.slice(0, 50)} @ ${job.company.slice(0, 25)}...`);
                    }
                } catch (e) {
                    // Skip malformed cards
                }

                // Small delay between processing cards
                await randomDelay(100, 300);
            }

            // Random delay between searches (2-5 seconds)
            await randomDelay(2000, 5000);

        } catch (error) {
            console.error(`  ❌ Error searching "${keyword}":`, error.message);
        }
    }

    // Remove duplicates by URL
    const uniqueJobs = [...new Map(jobs.map(j => [j.url, j])).values()];
    console.log(`  📊 LinkedIn: Found ${uniqueJobs.length} unique jobs`);

    return uniqueJobs;
}

/**
 * Create a fresh browser context for LinkedIn (no persistence)
 * This ensures a fresh "Guest" identity each run
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
        // No storage state = fresh guest identity
        storageState: undefined,
        // Randomize screen size
        screen: {
            width: 1920,
            height: 1080
        },
        // Accept language headers
        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8'
        }
    });

    return context;
}

module.exports = { scrapeLinkedIn, createLinkedInContext };
