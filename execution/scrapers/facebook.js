/**
 * Facebook Group Scraper (Authenticated Search)
 */

const CONFIG = require('../config');
const { randomDelay, humanScroll, mouseJiggle } = require('../lib/stealth');
const { calculateMatchScore } = require('../lib/filters');

/**
 * Scrape Facebook Groups using authenticated Search URL
 * @param {import('playwright').Page} page 
 * @param {import('../lib/telegram')} reporter 
 */
async function scrapeFacebook(page, reporter) {
    console.log('📘 Searching Facebook Groups (Authenticated)...');

    // Check if we are logged in (rough check)
    // We assume cookies are loaded in job-search.js

    const jobs = [];
    const RECENT_POSTS_FILTER = 'eyJyZWNlbnRfcG9zdHM6MCI6IntcIm5hbWVcIjpcInJlY2VudF9wb3N0c1wiLFwiYXJnc1wiOlwiXCJ9In0%3D';

    for (const groupUrl of CONFIG.facebookGroups) {
        try {
            // Extract Group ID or Name from URL
            // Format: https://www.facebook.com/groups/1875985159376456
            // Search URL: {groupUrl}/search?q={keyword}&filters={filter}

            // Allow single keyword 'golang' as per config
            const keyword = 'golang';

            const searchUrl = `${groupUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(keyword)}&filters=${RECENT_POSTS_FILTER}`;

            console.log(`  👥 Visiting Group Search: ${groupUrl}`);
            console.log(`  🔍 Search URL: ${searchUrl}`);

            // SLOW DOWN: Facebook detects rapid navigation
            await randomDelay(3000, 5000);

            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Random mouse movement to "confirm" humanity
            await mouseJiggle(page);
            await randomDelay(2000, 4000);

            // Check for login wall (just in case cookies failed)
            if (await page.locator('input[name="email"]').count() > 0) {
                console.log('  🔒 Login wall detected. Cookies might be invalid.');
                continue;
            }

            // Scroll a bit to load results - SLOWLY
            await humanScroll(page, 3);
            await randomDelay(2000, 3000);

            // Facebook search results are usually in Feed structure
            // Selectors for posts in a group search result can be tricky.
            // Often role="article" or specific classes.

            // Standard feed post selector
            const postSelector = 'div[role="article"], div[data-ad-preview="message"]';
            await page.waitForSelector(postSelector, { timeout: 10000 }).catch(() => { });

            const posts = await page.locator(postSelector).all();
            console.log(`  📄 Found ${posts.length} visible posts`);

            for (const post of posts.slice(0, 2)) {
                try {
                    // Extract Text
                    const text = await post.innerText().catch(() => '');
                    if (text.length < 50) continue;

                    const textLower = text.toLowerCase();

                    // 1. Strict Keyword Filter (Golang Only)
                    // Config.keywordRegex is helpful here
                    if (!CONFIG.keywordRegex.test(text) && !textLower.includes('golang')) continue;

                    // 2. Strict Exclude (Experience > 2y)
                    if (CONFIG.excludeRegex.test(text)) continue;

                    // 3. Location Filter (Remote or Can Tho Only)
                    const isTarget = textLower.includes('remote') || textLower.includes('từ xa') || textLower.includes('cần thơ') || textLower.includes('can tho');
                    const isHanoiHCM = textLower.includes('hà nội') || textLower.includes('hồ chí minh') || textLower.includes('hcm') || textLower.includes('ho chi minh');

                    if (!isTarget && isHanoiHCM) continue;

                    // 4. Date Heuristic
                    // Since we filtered by "Recent Posts", we assume they are relatively new.
                    // We can still try to exclude obviously old years if visible.
                    if (text.includes('2023') || text.includes('2022')) continue;

                    // Extract Link - often nested in timestamp or "View post"
                    // Try to find a link that contains "/groups/" and "/posts/" or "/permalink/"
                    const linkEl = post.locator('a[href*="/groups/"][href*="/posts/"], a[href*="/permalink/"]').first();
                    let urlStr = await linkEl.getAttribute('href').catch(() => null);

                    if (!urlStr) {
                        // Fallback: try to find any link to the post itself
                        urlStr = groupUrl;
                    }

                    // Clean URL (remove tracking params)
                    if (urlStr && urlStr.includes('?')) {
                        urlStr = urlStr.split('?')[0];
                    }

                    const job = {
                        title: text.split('\n')[0].slice(0, 100), // First line as title
                        company: 'Facebook Group',
                        url: urlStr,
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

        await randomDelay(2000, 3000);
    }

    // Deduplicate by URL
    const uniqueJobs = [...new Map(jobs.map(j => [j.url, j])).values()];
    return uniqueJobs;
}

module.exports = { scrapeFacebook };
