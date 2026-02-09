/**
 * Facebook Group Scraper (Authenticated Search)
 */

const CONFIG = require('../config');
const { randomDelay, humanScroll, mouseJiggle, applyStealthSettings } = require('../lib/stealth');
const { calculateMatchScore } = require('../lib/filters');

/**
 * Scrape Facebook Groups using authenticated Search URL
 * @param {import('playwright').Page} page 
 * @param {import('../lib/telegram')} reporter 
 */
async function scrapeFacebook(page, reporter) {
    console.log('📘 Searching Facebook Groups (Authenticated)...');

    // Ensure stealth settings are active
    await applyStealthSettings(page);

    const jobs = [];
    const RECENT_POSTS_FILTER = 'eyJyZWNlbnRfcG9zdHM6MCI6IntcIm5hbWVcIjpcInJlY2VudF9wb3N0c1wiLFwiYXJnc1wiOlwiXCJ9In0%3D';

    for (const groupUrl of CONFIG.facebookGroups) {
        try {
            // Allow single keyword 'golang' as per config
            const keyword = 'golang';

            // Strategy: Use DESKTOP Facebook (more stable selectors)
            const cleanGroupUrl = groupUrl.replace(/\/$/, '').replace('m.facebook.com', 'www.facebook.com');
            const searchUrl = `${cleanGroupUrl}/search?q=${encodeURIComponent(keyword)}&filters=${RECENT_POSTS_FILTER}`;

            console.log(`  👥 Visiting Group: ${cleanGroupUrl}`);

            // 1. Go to Group Home first (more natural)
            // Use user-provided cookies validation
            try {
                await page.goto(cleanGroupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            } catch (e) {
                console.log(`  ⚠️ Timeout visiting group home, trying search direct...`);
            }

            // Check for Blocked/Login - Strict Check
            // Don't use page.content() includes as it triggers on hidden scripts/comments
            const currentUrl = page.url();
            if (currentUrl.includes('/checkpoint/') || currentUrl.includes('/blocked/')) {
                console.log('  ⛔ Redirected to Checkpoint URL. Stopping.');
                await reporter.sendError('Facebook Scraper: Account flagged/blocked (URL Check).');
                return [];
            }

            // check for visible block message
            const blockedHeader = page.getByRole('heading', { name: /Temporarily Blocked|Account Restricted/i });
            if (await blockedHeader.isVisible()) {
                console.log('  ⛔ "Temporarily Blocked" message visible. Stopping.');
                await reporter.sendError('Facebook Scraper: Account flagged/blocked (UI Check).');
                return [];
            }

            await randomDelay(2000, 4000);
            await mouseJiggle(page);

            // 2. Navigate to Search with Referer
            console.log(`  🔍 Navigating to Search...`);
            await page.setExtraHTTPHeaders({
                'Referer': cleanGroupUrl
            });

            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Reset Headers
            await page.setExtraHTTPHeaders({});

            // 3. Confirm Humanity
            await mouseJiggle(page);
            await randomDelay(3000, 5000);

            // Check for login wall again (just in case)
            if (await page.locator('input[name="email"]').count() > 0) {
                console.log('  🔒 Login wall detected. Cookies might be invalid.');
                continue;
            }

            // Check for "No results"
            if (await page.getByText('No results found', { exact: false }).isVisible()) {
                console.log('  ℹ️ No results found for query.');
                continue;
            }

            // Scroll a bit to load results - SLOWLY
            await humanScroll(page, 3); // Less scrolling needed on mobile
            await randomDelay(2000, 4000);

            // Desktop Facebook uses div[role="article"] for posts
            const postSelector = 'div[role="article"]';

            try {
                await page.waitForSelector(postSelector, { timeout: 10000 });
            } catch (e) {
                console.log('  ⚠️ Post selector not found (might be no results or layout change)');
            }

            const posts = await page.locator(postSelector).all();
            console.log(`  📄 Found ${posts.length} visible posts`);

            // We'll try to collect up to 3 valid posts, checking up to 10 sections
            const maxValidPosts = 3;
            const maxAttempts = Math.min(10, posts.length);
            let validPostsCount = 0;

            for (let i = 0; i < maxAttempts && validPostsCount < maxValidPosts; i++) {
                const post = posts[i];
                try {
                    // Extract Text and HTML for profile detection
                    const text = await post.innerText().catch(() => '');
                    const outerHtml = await post.evaluate(el => el.outerHTML).catch(() => '');

                    // 🚫 PROFILE DETECTION: Skip if this is a member profile, not a post
                    if (outerHtml.includes('View profile') || outerHtml.includes('Add friend')) {
                        console.log(`    ⏭️ Skipping member profile (detected "View profile" or "Add friend")`);
                        continue;
                    }

                    // No minimum text length requirement - even short quality posts are valuable!
                    if (!text || text.trim().length === 0) continue;

                    const textLower = text.toLowerCase();

                    // 1. Strict Keyword Filter (Golang Only)
                    if (!CONFIG.keywordRegex.test(text) && !textLower.includes('golang')) continue;

                    // 2. Strict Exclude (Experience > 2y)
                    if (CONFIG.excludeRegex.test(text)) continue;

                    // 2.5. BOOST: Prioritize fresher/intern/junior posts (includeRegex)
                    const isFresherPost = CONFIG.includeRegex.test(text);
                    if (isFresherPost) {
                        console.log(`    🎯 FRESHER/JUNIOR post detected!`);
                    }

                    // 3. Location Filter
                    const isTarget = textLower.includes('remote') || textLower.includes('từ xa') ||
                        textLower.includes('cần thơ') || textLower.includes('can tho') ||
                        textLower.includes('online');
                    const isHanoiHCM = textLower.includes('hà nội') || textLower.includes('hồ chí minh') ||
                        textLower.includes('hcm') || textLower.includes('ho chi minh');

                    if (!isTarget && isHanoiHCM) continue;

                    // 4. Dynamic Date Heuristic (exclude old posts from previous years)
                    const currentYear = new Date().getFullYear();
                    const lastYear = currentYear - 1;
                    const oldYearPattern = new RegExp(`\\b(${currentYear - 2}|${currentYear - 3}|${currentYear - 4})\\b`);
                    if (oldYearPattern.test(text)) {
                        console.log(`    ⏭️ Skipping old post (found year older than ${lastYear})`);
                        continue;
                    }

                    // Use group URL directly - simpler and more reliable
                    // Users can search for the post using the preview text
                    const urlStr = cleanGroupUrl;


                    const job = {
                        title: text.split('\n')[0].slice(0, 100), // First line as title
                        company: 'Facebook Group',
                        url: urlStr,
                        preview: text.slice(0, 100).trim(), // NEW: Preview text for manual search
                        salary: 'Negotiable',
                        location: isTarget ? (textLower.includes('cần thơ') ? 'Cần Thơ' : 'Remote') : 'Unknown',
                        source: 'Facebook',
                        techStack: 'Golang',
                        description: text.slice(0, 300), // Extract preview text for Telegram
                        postedDate: 'Recent',
                        matchScore: calculateMatchScore({ title: text, location: isTarget ? 'remote' : 'unknown' }),
                        isFresher: isFresherPost // Flag for fresher/junior posts
                    };

                    jobs.push(job);
                    validPostsCount++; // Increment valid posts counter
                    console.log(`    ✅ Potential Post: ${job.title.slice(0, 40)}...`);

                } catch (e) {
                    // skip
                }
            }

        } catch (error) {
            console.error(`  ❌ Error searching group ${groupUrl}: ${error.message}`);
        }

        await randomDelay(3000, 6000); // Longer delay between groups
    }

    // Deduplicate by URL
    const uniqueJobs = [...new Map(jobs.map(j => [j.url, j])).values()];
    return uniqueJobs;
}

module.exports = { scrapeFacebook };
