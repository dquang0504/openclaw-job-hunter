/**
 * Facebook Group Scraper (Authenticated Search)
 */

const CONFIG = require('../config');
const { randomDelay, humanScroll, mouseJiggle, applyStealthSettings, idleBehavior } = require('../lib/stealth');
const { calculateMatchScore, shouldIncludeJob } = require('../lib/filters');
const ScreenshotDebugger = require('../lib/screenshot');

/**
 * Helper: Normalize text to handle fancy fonts and accents
 */
const normalizeText = (text) => (text || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Scrape Facebook Groups using authenticated Search URL
 * @param {import('playwright').Page} page 
 * @param {import('../lib/telegram')} reporter 
 */
async function scrapeFacebook(page, reporter) {
    console.log('📘 Searching Facebook Groups (Authenticated)...');

    // Ensure stealth settings are active
    await applyStealthSettings(page);

    const screenshotDebugger = new ScreenshotDebugger(reporter);
    const jobs = [];
    const context = page.context();

    // --- WARM UP PHASE ---
    try {
        console.log('🏠 Navigating to Facebook Home for warm-up...');
        await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });

        // Randomize warm-up duration (10-20s)
        const warmUpDuration = 10000 + Math.random() * 10000;
        const startTime = Date.now();
        console.log(`⏳ Warming up for ${(warmUpDuration / 1000).toFixed(1)}s with random behaviors...`);

        while (Date.now() - startTime < warmUpDuration) {
            await mouseJiggle(page);
            await page.waitForTimeout(2000 + Math.random() * 2000);
        }
        console.log('✅ Warm-up complete. Starting scraping...');
    } catch (e) {
        console.log('⚠️ Warm-up failed (non-critical):', e.message);
    }
    // --- END WARM UP ---

    // Filter for 2026: start_year:2026, end_year:2026
    const RECENT_POSTS_FILTER = 'eyJyZWNlbnRfcG9zdHM6MCI6IntcIm5hbWVcIjpcInJlY2VudF9wb3N0c1wiLFwiYXJnc1wiOlwiXCJ9IiwicnBfY3JlYXRpb25fdGltZTowIjoie1wibmFtZVwiOlwiY3JlYXRpb25fdGltZVwiLFwiYXJnc1wiOlwie1xcXCJzdGFydF95ZWFyXFxcIjpcXFwiMjAyNlxcXCIsXFxcInN0YXJ0X21vbnRoXFxcIjpcXFwiMjAyNi0xXFxcIixcXFwiZW5kX3llYXJcXFwiOlxcXCIyMDI2XFxcIixcXFwiZW5kX21vbnRoXFxcIjpcXFwiMjAyNi0xMlxcXCIsXFxcInN0YXJ0X2RheVxcXCI6XFxcIjIwMjYtMS0xXFxcIixcXFwiZW5kX2RheVxcXCI6XFxcIjIwMjYtMTItMzFcXFwifVwifSJ9';

    for (const groupUrl of CONFIG.facebookGroups) {
        try {
            const keyword = 'golang';
            const cleanGroupUrl = groupUrl.replace(/\/$/, '')
                .replace('mbasic.facebook.com', 'www.facebook.com')
                .replace('m.facebook.com', 'www.facebook.com');

            // Desktop Search URL
            const searchUrl = `${cleanGroupUrl}/search?q=${encodeURIComponent(keyword)}&filters=${RECENT_POSTS_FILTER}`;

            console.log(`  👥 Visiting Group Search: ${cleanGroupUrl}`);

            await page.setExtraHTTPHeaders({ 'Referer': cleanGroupUrl });
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.setExtraHTTPHeaders({});

            await randomDelay(3000, 5000);
            await mouseJiggle(page);

            // Check for Blocked/Login
            if (page.url().includes('checkpoint') || await page.locator('input[name="email"]').count() > 0) {
                console.log('  ⛔ Checkpoint/Login detected. Skipping.');
                continue;
            }

            // Scroll to load posts
            console.log('    ⏳ Loading posts...');
            await humanScroll(page, 5);
            await randomDelay(2000, 3000);

            // Desktop Selectors
            const postSelector = 'div[role="feed"] > div, div[role="article"]';
            const postsCount = await page.locator(postSelector).count();
            console.log(`    📄 Found ${postsCount} potential posts in feed.`);

            const maxPostsToCheck = Math.min(postsCount, 20); // Check up to 20
            const processedUrls = new Set();
            let validPostsInGroup = 0;

            for (let i = 0; i < maxPostsToCheck; i++) {
                if (validPostsInGroup >= 5) break; // Limit per group

                // Scroll to item
                const post = page.locator(postSelector).nth(i);
                if (await post.isVisible()) {
                    await post.scrollIntoViewIfNeeded();
                    await page.waitForTimeout(500); // Settle
                }

                // Strategy: Extract URL -> Open in New Tab -> Scrape -> Filter -> Close
                let postUrl = '';
                try {
                    // Try to find permalink in standard locations
                    // 1. Timestamp usually has the link
                    const links = await post.locator('a[href*="/posts/"], a[href*="/permalink/"], a[href*="/groups/"]').all();
                    for (const link of links) {
                        const href = await link.getAttribute('href');
                        if (href && (href.match(/\/posts\/\d+/) || href.match(/\/permalink\/\d+/))) {
                            postUrl = href;
                            break;
                        }
                    }

                    // Normalize URL
                    if (postUrl) {
                        if (postUrl.startsWith('/')) postUrl = `https://www.facebook.com${postUrl}`;
                        // Remove tracking params
                        postUrl = postUrl.replace(/(\?|&)__cft__.*$/, '').replace(/(\?|&)ref=.*$/, '');
                    }
                } catch (e) { }

                if (!postUrl) {
                    // console.log(`      ⚠️ Could not extract URL for post ${i}. Skipping.`);
                    continue;
                }

                if (processedUrls.has(postUrl)) continue;
                processedUrls.add(postUrl);

                console.log(`    🔍 Inspecting Post ${i + 1}/${maxPostsToCheck}: ${postUrl}`);

                // OPEN NEW TAB
                let detailPage = null;
                try {
                    detailPage = await context.newPage();
                    await detailPage.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                    // Wait for content
                    try {
                        await detailPage.waitForSelector('div[role="main"], div.x1n2onr6', { state: 'visible', timeout: 5000 });
                    } catch (e) {
                        // Sometimes simple content
                    }

                    // SIMULATE READING BEHAVIOR
                    await randomDelay(1000, 2000); // Initial load wait
                    await humanScroll(detailPage, 2); // Scroll down to read
                    await randomDelay(1000, 2500); // Read content

                    // Get Full Text
                    const bodyText = await detailPage.locator('body').innerText();
                    const cleanText = normalizeText(bodyText);

                    // Quick content check on Detail Page
                    const job = {
                        title: (await detailPage.title()).replace(' | Facebook', ''),
                        company: 'Facebook Group',
                        url: postUrl,
                        description: bodyText.slice(0, 2000), // Cap length
                        location: 'Unknown',
                        source: 'Facebook',
                        techStack: 'Golang',
                        postedDate: 'Recent', // We rely on the search filter "2026"
                        isFresher: false
                    };

                    // === FILTER IMMEDIATELY ===
                    const shouldInclude = shouldIncludeJob(job);
                    if (!shouldInclude) {
                        console.log(`      ❌ Filtered out (Exp/Date/Content).`);
                        continue;
                    }

                    // Determine Location
                    if (cleanText.includes('hanoi') || cleanText.includes('ha noi')) job.location = 'Hanoi';
                    else if (cleanText.includes('ho chi minh') || cleanText.includes('hcm') || cleanText.includes('saigon')) job.location = 'HCM';
                    else if (cleanText.includes('remote')) job.location = 'Remote';

                    // Match Score
                    job.matchScore = calculateMatchScore(job);

                    console.log(`      ✅ Valid Job Found! Score: ${job.matchScore}`);
                    jobs.push(job);
                    validPostsInGroup++;

                } catch (e) {
                    console.log(`      ⚠️ Error processing detail page: ${e.message}`);
                } finally {
                    if (detailPage) await detailPage.close();
                    await randomDelay(1000, 2000); // Be gentle
                }
            }

        } catch (error) {
            console.error(`  ❌ Error searching group ${groupUrl}: ${error.message}`);
        }
    }

    const uniqueJobs = [...new Map(jobs.map(j => [j.url, j])).values()];
    return uniqueJobs;
}

module.exports = { scrapeFacebook };
