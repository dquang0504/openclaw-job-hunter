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

            // Strategy: Use MOBILE Facebook for simpler HTML structure
            const cleanGroupUrl = groupUrl.replace(/\/$/, '').replace('www.facebook.com', 'm.facebook.com');
            const searchUrl = `${cleanGroupUrl}/search?q=${encodeURIComponent(keyword)}&filters=${RECENT_POSTS_FILTER}`;

            console.log(`  👥 Visiting Group (Mobile): ${cleanGroupUrl}`);

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

            // Mobile Facebook uses simpler selectors
            // Posts are usually in <article> or div with data-ft attribute
            const postSelector = 'article, div[data-ft]';

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

                    // Extract Link - Mobile Facebook has simpler structure
                    let urlStr = null;

                    console.log(`    🔍 DEBUG: Starting URL extraction for post (Mobile)...`);

                    // STRATEGY 1: Check data-ft attribute (mobile-specific)
                    try {
                        const dataFt = await post.getAttribute('data-ft');
                        if (dataFt) {
                            console.log(`    🔍 DEBUG: Found data-ft attribute: ${dataFt.slice(0, 150)}...`);

                            // Parse data-ft JSON to extract story_fbid or top_level_post_id
                            try {
                                const ftData = JSON.parse(dataFt);
                                const postId = ftData.mf_story_key || ftData.top_level_post_id || ftData.content_owner_id_new;

                                if (postId) {
                                    // Extract group ID from URL
                                    const groupMatch = cleanGroupUrl.match(/groups\/([^\/]+)/);
                                    const groupId = groupMatch ? groupMatch[1] : null;

                                    if (groupId) {
                                        // Convert to desktop URL for better compatibility
                                        urlStr = `https://www.facebook.com/groups/${groupId}/posts/${postId}/`;
                                        console.log(`    ✅ Extracted URL from data-ft: ${urlStr}`);
                                    }
                                }
                            } catch (e) {
                                console.log(`    ⚠️ DEBUG: Failed to parse data-ft JSON: ${e.message}`);
                            }
                        }
                    } catch (e) {
                        console.log(`    ⚠️ DEBUG: data-ft strategy failed: ${e.message}`);
                    }

                    // STRATEGY 2: Find links in mobile HTML (much simpler than desktop)
                    if (!urlStr) {
                        const allAnchors = await post.locator('a').all();
                        console.log(`    🔍 DEBUG: Found ${allAnchors.length} anchor tags in mobile post`);

                        for (const anchor of allAnchors) {
                            const href = await anchor.getAttribute('href');
                            if (!href) continue;

                            console.log(`    🔍 DEBUG: Checking href: ${href.slice(0, 100)}...`);

                            // Mobile links are usually cleaner: /story.php?story_fbid=... or /groups/.../permalink/...
                            if (href.includes('story_fbid=') || href.includes('/permalink/') || href.includes('/posts/')) {
                                try {
                                    // Extract story_fbid from URL
                                    let postId = null;
                                    let groupId = null;

                                    // Pattern 1: story.php?story_fbid=123&id=456
                                    const storyMatch = href.match(/story_fbid=(\d+)/);
                                    const idMatch = href.match(/[&?]id=(\d+)/);

                                    if (storyMatch) {
                                        postId = storyMatch[1];
                                        groupId = idMatch ? idMatch[1] : null;
                                    }

                                    // Pattern 2: /groups/123/permalink/456/
                                    const permalinkMatch = href.match(/\/groups\/([^\/]+)\/permalink\/(\d+)/);
                                    if (permalinkMatch) {
                                        groupId = permalinkMatch[1];
                                        postId = permalinkMatch[2];
                                    }

                                    // Pattern 3: /groups/123/posts/456/
                                    const postsMatch = href.match(/\/groups\/([^\/]+)\/posts\/(\d+)/);
                                    if (postsMatch) {
                                        groupId = postsMatch[1];
                                        postId = postsMatch[2];
                                    }

                                    if (postId && groupId) {
                                        // Convert to desktop URL
                                        urlStr = `https://www.facebook.com/groups/${groupId}/posts/${postId}/`;
                                        console.log(`    ✅ Extracted URL from mobile link: ${urlStr}`);
                                        break;
                                    } else if (postId) {
                                        // Use group from cleanGroupUrl
                                        const groupMatch = cleanGroupUrl.match(/groups\/([^\/]+)/);
                                        groupId = groupMatch ? groupMatch[1] : null;

                                        if (groupId) {
                                            urlStr = `https://www.facebook.com/groups/${groupId}/posts/${postId}/`;
                                            console.log(`    ✅ Extracted URL (partial match): ${urlStr}`);
                                            break;
                                        }
                                    }
                                } catch (e) {
                                    console.log(`    ⚠️ DEBUG: URL extraction failed: ${e.message}`);
                                }
                            }
                        }
                    }

                    // Final cleanup
                    if (urlStr && urlStr.startsWith('/')) {
                        urlStr = 'https://www.facebook.com' + urlStr;
                    }

                    // 🔧 TEMPORARY WORKAROUND: If we can't extract specific URL, use group URL
                    if (!urlStr || urlStr === groupUrl || (!urlStr.includes('/posts/') && !urlStr.includes('/permalink/'))) {
                        urlStr = cleanGroupUrl.replace('m.facebook.com', 'www.facebook.com'); // Convert back to desktop
                        const preview = text.slice(0, 80).replace(/\n/g, ' ');
                        console.log(`    ⚠️ Using group URL as fallback`);
                        console.log(`       Preview: "${preview}..."`);
                    }

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
