/**
 * Threads Scraper (Authenticated Search)
 * Uses hidden JSON data from script tags instead of DOM selectors
 */

const CONFIG = require('../config');
const { randomDelay, humanScroll, mouseJiggle } = require('../lib/stealth');
const { calculateMatchScore } = require('../lib/filters');

/**
 * Extract posts from Threads JSON data
 * @param {Object} data - Parsed JSON from script tag
 * @returns {Array} - Array of post objects
 */
function extractPostsFromJSON(data) {
    const posts = [];

    try {
        // Threads data structure is deeply nested
        // Common paths: data.thread_items, data.edges, etc.

        // Try multiple possible paths
        let threadItems = null;

        if (data.require) {
            // Format 1: data.require[...][...].thread_items
            for (const req of data.require || []) {
                if (Array.isArray(req)) {
                    for (const item of req) {
                        if (item && typeof item === 'object') {
                            // Deep search for thread_items
                            const found = findThreadItems(item);
                            if (found) {
                                threadItems = found;
                                break;
                            }
                        }
                    }
                }
                if (threadItems) break;
            }
        }

        // Format 2: Direct thread_items
        if (!threadItems && data.thread_items) {
            threadItems = data.thread_items;
        }

        if (!threadItems || !Array.isArray(threadItems)) {
            return posts;
        }

        // Extract post data
        for (const item of threadItems) {
            try {
                const thread = item.thread_item || item;
                const post = thread.post || thread;

                if (!post) continue;

                const caption = post.caption?.text || '';
                const user = post.user?.username || 'unknown';
                const postId = post.id || post.pk || '';
                const takenAt = post.taken_at || 0;

                if (caption && postId) {
                    posts.push({
                        id: postId,
                        text: caption,
                        username: user,
                        timestamp: takenAt,
                        url: `https://www.threads.net/@${user}/post/${postId}`
                    });
                }
            } catch (e) {
                // Skip malformed items
                continue;
            }
        }
    } catch (e) {
        console.error('  ⚠️ Error extracting posts from JSON:', e.message);
    }

    return posts;
}

/**
 * Recursively search for thread_items in nested object
 */
function findThreadItems(obj, depth = 0) {
    if (depth > 10) return null; // Prevent infinite recursion

    if (obj && typeof obj === 'object') {
        if (obj.thread_items && Array.isArray(obj.thread_items)) {
            return obj.thread_items;
        }

        for (const key in obj) {
            const result = findThreadItems(obj[key], depth + 1);
            if (result) return result;
        }
    }

    return null;
}

/**
 * Scrape Threads using authenticated search
 * @param {import('playwright').Page} page 
 * @param {import('../lib/telegram')} reporter 
 */
async function scrapeThreads(page, reporter) {
    console.log('🧵 Searching Threads (Authenticated)...');

    const jobs = [];
    const seenPostIds = new Set(); // Deduplication

    const keywords = ['golang', 'fresher golang', 'junior golang'];

    for (const keyword of keywords) {
        try {
            const searchUrl = `https://www.threads.net/search?q=${encodeURIComponent(keyword)}&serp_type=default`;

            console.log(`  🔍 Searching: "${keyword}"`);

            // Navigate to search
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await randomDelay(2000, 4000);

            // Check for login wall
            const currentUrl = page.url();
            if (currentUrl.includes('/login') || currentUrl.includes('/accounts/login')) {
                console.log('  🔒 Login wall detected. Cookies might be invalid.');
                await reporter.sendError('Threads Scraper: Login required (cookies invalid)');
                return [];
            }

            // Wait for posts to load
            try {
                await page.waitForSelector('[data-pressable-container="true"]', { timeout: 10000 });
            } catch (e) {
                console.log('  ⚠️ Posts container not found, trying to extract anyway...');
            }

            await mouseJiggle(page);
            await randomDelay(2000, 3000);

            // Scroll to load more posts
            await humanScroll(page, 3);
            await randomDelay(2000, 3000);

            // Extract JSON data from script tags
            console.log('  📦 Extracting JSON data from script tags...');

            const scripts = await page.$$eval('script[type="application/json"][data-sjs]', elements =>
                elements.map(el => el.textContent)
            );

            console.log(`  📄 Found ${scripts.length} script tags`);

            let allPosts = [];

            for (const content of scripts) {
                if (content && (content.includes('thread_items') || content.includes('thread_item'))) {
                    try {
                        const data = JSON.parse(content);
                        const posts = extractPostsFromJSON(data);
                        allPosts = allPosts.concat(posts);
                    } catch (e) {
                        // Skip invalid JSON
                        continue;
                    }
                }
            }

            console.log(`  📊 Extracted ${allPosts.length} posts from JSON`);

            // Filter posts with strict logic
            for (const post of allPosts) {
                // Deduplication
                if (seenPostIds.has(post.id)) continue;
                seenPostIds.add(post.id);

                const text = post.text;
                const textLower = text.toLowerCase();

                // 1. Strict Keyword Filter: Must contain "golang"
                if (!CONFIG.keywordRegex.test(text) && !textLower.includes('golang')) continue;

                // 2. Skip old posts (older than 2 years)
                const currentYear = new Date().getFullYear();
                const oldYearPattern = new RegExp(`\\b(${currentYear - 2}|${currentYear - 3}|${currentYear - 4})\\b`);
                if (oldYearPattern.test(text)) {
                    console.log(`    ⏭️ Skipping old post (found year older than ${currentYear - 1})`);
                    continue;
                }

                // 3. Detect if it's a fresher/junior post
                const isFresherPost = CONFIG.includeRegex.test(text);
                if (isFresherPost) {
                    console.log(`    🎯 FRESHER/JUNIOR post detected!`);
                }

                // 4. Detect location (but don't filter)
                let location = 'Unknown';
                if (textLower.includes('remote') || textLower.includes('từ xa') || textLower.includes('online')) {
                    location = 'Remote';
                } else if (textLower.includes('cần thơ') || textLower.includes('can tho')) {
                    location = 'Cần Thơ';
                } else if (textLower.includes('hà nội') || textLower.includes('hồ chí minh') || textLower.includes('hcm') || textLower.includes('ho chi minh')) {
                    location = 'Hanoi/HCM';
                }

                const job = {
                    title: text.split('\n')[0].slice(0, 100), // First line as title
                    company: `@${post.username}`,
                    url: post.url,
                    preview: text.slice(0, 100).trim(),
                    salary: 'Negotiable',
                    location: location,
                    source: 'Threads',
                    techStack: 'Golang',
                    description: text.slice(0, 300),
                    postedDate: post.timestamp ? new Date(post.timestamp * 1000).toLocaleDateString() : 'Recent',
                    matchScore: calculateMatchScore({ title: text, location: location.toLowerCase() }),
                    isFresher: isFresherPost
                };

                jobs.push(job);
                console.log(`    ✅ Post: ${job.title.slice(0, 40)}... (@${post.username})`);

                // Limit to 5 posts per keyword
                if (jobs.length >= 5) break;
            }

            await randomDelay(3000, 5000); // Delay between keywords

        } catch (error) {
            console.error(`  ❌ Error searching "${keyword}": ${error.message}`);
        }
    }

    // Deduplicate by URL
    const uniqueJobs = [...new Map(jobs.map(j => [j.url, j])).values()];
    console.log(`  ✅ Found ${uniqueJobs.length} unique jobs`);

    return uniqueJobs;
}

module.exports = { scrapeThreads };
