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

            // Strategy: Visit Group Page first to set cookies/referer then go to Search
            const cleanGroupUrl = groupUrl.replace(/\/$/, '');
            const searchUrl = `${cleanGroupUrl}/search?q=${encodeURIComponent(keyword)}&filters=${RECENT_POSTS_FILTER}`;

            console.log(`  👥 Visiting Group: ${cleanGroupUrl}`);

            // 1. Go to Group Home first (more natural)
            // Use user-provided cookies validation
            try {
                await page.goto(cleanGroupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            } catch (e) {
                console.log(`  ⚠️ Timeout visiting group home, trying search direct...`);
            }

            // Check for Blocked/Login
            const pageContent = await page.content();
            if (pageContent.includes('Temporarily Blocked') || pageContent.includes('You’re Temporarily Blocked') || pageContent.includes('checkpoint')) {
                console.log('  ⛔ Account Temporarily Blocked or Checkpoint! Stopping Facebook scrape.');
                await reporter.sendError('Facebook Scraper: Account flagged/blocked. Please check manually.');
                return []; // Stop completely to protect account
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
            await humanScroll(page, 5); // Scroll more
            await randomDelay(2000, 4000);

            // Standard feed post selector - try updated selectors
            // div[role="article"] is standard
            // div[data-ad-preview="message"] is for ads/posts
            // div.x1yztbdb is a common obfuscated class for feed units
            const postSelector = 'div[role="article"], div[data-ad-preview="message"], div[class*="feed"] div[role="article"]';

            try {
                await page.waitForSelector(postSelector, { timeout: 10000 });
            } catch (e) {
                console.log('  ⚠️ Post selector not found (might be no results or layout change)');
            }

            const posts = await page.locator(postSelector).all();
            console.log(`  📄 Found ${posts.length} visible posts`);

            for (const post of posts.slice(0, 3)) { // Check top 3
                try {
                    // Extract Text
                    const text = await post.innerText().catch(() => '');
                    if (text.length < 50) continue;

                    const textLower = text.toLowerCase();

                    // 1. Strict Keyword Filter (Golang Only)
                    if (!CONFIG.keywordRegex.test(text) && !textLower.includes('golang')) continue;

                    // 2. Strict Exclude (Experience > 2y)
                    if (CONFIG.excludeRegex.test(text)) continue;

                    // 3. Location Filter
                    const isTarget = textLower.includes('remote') || textLower.includes('từ xa') || textLower.includes('cần thơ') || textLower.includes('can tho');
                    const isHanoiHCM = textLower.includes('hà nội') || textLower.includes('hồ chí minh') || textLower.includes('hcm') || textLower.includes('ho chi minh');

                    if (!isTarget && isHanoiHCM) continue;

                    // 4. Date Heuristic
                    if (text.includes('2023') || text.includes('2022')) continue;

                    // Extract Link - often nested in timestamp or "View post"
                    // Try to find a link that contains "/groups/" and "/posts/" or "/permalink/"
                    // Stealth tip: Hover over link before extracting? No need.

                    const linkEl = post.locator('a[href*="/groups/"][href*="/posts/"], a[href*="/permalink/"]').first();
                    let urlStr = await linkEl.getAttribute('href').catch(() => null);

                    if (!urlStr) {
                        // Try finding date string which is usually a link
                        // Look for 'a' tag that has aria-label containing time like "1 h", "Yesterday"
                        // This is complex, fallback to groupUrl is safer
                        urlStr = groupUrl;
                    }

                    // Clean URL (remove tracking params)
                    if (urlStr && urlStr.includes('?')) {
                        urlStr = urlStr.split('?')[0];
                    }

                    // Fix relative URLs
                    if (urlStr && urlStr.startsWith('/')) {
                        urlStr = 'https://www.facebook.com' + urlStr;
                    }

                    const job = {
                        title: text.split('\n')[0].slice(0, 100), // First line as title
                        company: 'Facebook Group',
                        url: urlStr || groupUrl,
                        salary: 'Negotiable',
                        location: isTarget ? (textLower.includes('cần thơ') ? 'Cần Thơ' : 'Remote') : 'Unknown',
                        source: 'Facebook',
                        techStack: 'Golang',
                        description: text.slice(0, 300) + '...',
                        postedDate: 'Recent',
                        matchScore: calculateMatchScore({ title: text, location: isTarget ? 'remote' : 'unknown' })
                    };

                    jobs.push(job);
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
