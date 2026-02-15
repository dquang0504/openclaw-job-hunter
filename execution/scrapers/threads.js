/**
 * Threads Scraper (Authenticated Search)
 * Uses hidden JSON data from script tags instead of DOM selectors
 */

const CONFIG = require('../config');
const { randomDelay, humanScroll, mouseJiggle } = require('../lib/stealth');
const { calculateMatchScore } = require('../lib/filters');

/**
 * Helper: Normalize text to handle fancy fonts and accents
 * e.g. "𝐆𝐨𝐥𝐚𝐧𝐠" -> "golang", "Hà Nội" -> "ha noi"
 */
const normalizeText = (text) => (text || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Helper: Format Unix timestamp to dd/mm/yyyy hh:mm:ss
 */
function formatExactDate(timestamp) {
    if (!timestamp) return 'Unknown';
    // Threads/Instagram timestamps are in seconds
    const date = new Date(timestamp * 1000);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

/**
 * Helper: Extract Salary from text
 */
function extractSalary(text) {
    const textNorm = normalizeText(text);

    // Check for explicit "negotiable" or "thỏa thuận"
    if (textNorm.includes('negotiable') || textNorm.includes('thoa thuan') || textNorm.includes('thu nhap hap dan') || textNorm.includes('luong hap dan')) {
        return 'Negotiable';
    }

    // Regex for money patterns
    const moneyRegex = /((?:\$|usd\s?)\d{3,5}|\d{1,3}\s?(?:tr|trieu|m)(?:\s?-\s?\d{1,3}\s?(?:tr|trieu|m))?|\d{3,5}\s?(?:\$|usd))/gi;
    const matches = textNorm.match(moneyRegex);

    if (matches && matches.length > 0) {
        return matches[0].trim();
    }

    return 'Negotiable';
}

/**
 * Helper: Extract Location from text
 */
function extractLocation(text) {
    const textNorm = normalizeText(text);

    if (textNorm.includes('remote') || textNorm.includes('tu xa') || textNorm.includes('wfh')) return 'Remote';
    if (textNorm.match(/(hcm|ho chi minh|saigon|sai gon)/)) return 'Ho Chi Minh';
    if (textNorm.match(/(ha noi|hanoi)/)) return 'Hanoi';
    if (textNorm.match(/(da nang|danang)/)) return 'Da Nang';

    return 'Unknown';
}

/**
 * Validates if the post is strictly relevant to the target tech stack (Golang)
 */
function isRelevantPost(text) {
    const t = normalizeText(text);
    // Regex for strict Golang relevance
    const strictRegex = /\b(golang|go\s?lang|go\s?dev|go\s?engineer|backend\s?go)\b/i;

    return strictRegex.test(t);
}

/**
 * Helper: Calculate internal match score
 */
function calculateInternalScore(text, isFresher, salary, location) {
    let score = 0;
    const textNorm = normalizeText(text);

    // Base score for passing validation
    score += 5;

    // Tech stack specific boosts
    if (textNorm.includes('golang')) score += 2;
    if (textNorm.includes('backend') || textNorm.includes('back-end')) score += 1;
    if (textNorm.includes('cloud') || textNorm.includes('aws') || textNorm.includes('docker')) score += 1;

    // Fresher/Level specific
    if (isFresher) score += 1;

    // Content data quality
    if (salary !== 'Negotiable') score += 1;
    if (location !== 'Unknown') score += 1;

    return Math.min(score, 10);
}

/**
 * Extract posts from Threads JSON data (Recursive & Flexible)
 */
function extractPostsFromJSON(data) {
    const posts = [];
    const MAX_DEPTH = 15;

    // Helper to recursively find post objects
    function findPosts(obj, depth = 0) {
        if (depth > MAX_DEPTH || !obj || typeof obj !== 'object') return;

        // Check if this object looks like a post
        if (obj.pk && obj.caption !== undefined && obj.user) {
            processPost(obj);
            return;
        }

        // Also check for "post" key which wraps the actual post
        if (obj.post && obj.post.pk && obj.post.user) {
            processPost(obj.post);
        }

        // Arrays
        if (Array.isArray(obj)) {
            obj.forEach(item => findPosts(item, depth + 1));
            return;
        }

        // Object keys
        for (const key in obj) {
            if (['__typename', 'viewer', 'extensions'].includes(key)) continue;
            findPosts(obj[key], depth + 1);
        }
    }

    function processPost(post) {
        try {
            const postId = post.id || post.pk;
            if (!postId) return;

            const caption = post.caption?.text || post.text || '';
            const user = post.user?.username;
            const takenAt = post.taken_at || post.timestamp || 0;

            if (user && (caption || post.image_versions2)) {
                posts.push({
                    id: postId,
                    text: caption,
                    username: user,
                    timestamp: takenAt, // Keep raw timestamp
                    url: `https://www.threads.net/@${user}/post/${post.code || postId}`,
                    is_paid_partnership: post.is_paid_partnership,
                    source_type: 'JSON'
                });
            }
        } catch (e) {
            // Ignore malformed
        }
    }

    findPosts(data);
    return posts;
}

/**
 * Scrape a single keyword on a specific page
 */
async function scrapeKeyword(page, keyword, reporter) {
    const jobs = [];
    const seenPostIds = new Set();
    const TARGET_POSTS_PER_KEYWORD = 100;

    // Timespan: 2 months (60 days)
    // Dynamic Filter
    const TWO_MONTHS_MS = 60 * 24 * 60 * 60 * 1000;
    const CUTOFF_DATE = Date.now() - TWO_MONTHS_MS;
    console.log(`    📅 Date Filter: Posts after ${new Date(CUTOFF_DATE).toLocaleDateString()} only.`);

    // Listen for GraphQL responses
    const capturedResponses = [];
    const responseListener = async (response) => {
        try {
            const url = response.url();
            if (url.includes('/api/graphql') || url.includes('searchResults') || url.includes('search_serp')) {
                const contentType = response.headers()['content-type'];
                if (contentType && contentType.includes('application/json')) {
                    const json = await response.json();
                    capturedResponses.push(json);
                }
            }
        } catch (e) { }
    };

    page.on('response', responseListener);

    try {
        const searchUrl = `https://www.threads.net/search?q=${encodeURIComponent(keyword)}&serp_type=default&filter=recent`;
        console.log(`\n  🔍 Searching: "${keyword}" (Target: ~${TARGET_POSTS_PER_KEYWORD} posts)`);

        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await randomDelay(2000, 3000);

        if (page.url().includes('/login')) {
            console.log('  🔒 Login wall detected.');
            return [];
        }

        // --- Scroll Loop ---
        let previousHeight = 0;
        let noChangeCount = 0;
        let loadedPostsForKeyword = 0;

        for (let i = 0; i < 20; i++) {

            // 1. Extract from DOM (Script tags + Captured Network Responses)
            const currentData = [...capturedResponses];
            const scripts = await page.$$eval('script[type="application/json"]', els => els.map(e => ({ type: e.type, id: e.id, content: e.textContent })));

            const allDataSources = [
                ...scripts.map(s => {
                    try { return JSON.parse(s.content); } catch (e) { return null; }
                }),
                ...currentData
            ].filter(Boolean);

            let keywordPosts = [];
            for (const data of allDataSources) {
                const posts = extractPostsFromJSON(data);
                keywordPosts = keywordPosts.concat(posts);
            }

            // 2. Fallback: Extract directly from DOM if JSON failed
            // Usage of data-pressable-container="true" based on latest HTML structure
            const domPosts = await page.$$eval('div[data-pressable-container="true"]', (elements) => {
                const results = [];

                elements.forEach(container => {
                    // Safety check to ensure we are looking at a post
                    if (!container.innerText) return;

                    const text = container.innerText;
                    if (!text || text.length < 5) return;

                    // Extract Link and ID
                    const linkEl = container.querySelector('a[href*="/post/"]');
                    const url = linkEl ? linkEl.href : '';
                    if (!url) return; // Must have a post link

                    const id = url.split('/post/')[1].replace(/\/$/, '');

                    // Extract Username
                    let username = 'unknown';
                    // User link usually comes before post link or is separate. 
                    // The HTML shows <a href="/@username">...</a>
                    const userEl = container.querySelector('a[href^="/@"]:not([href*="/post/"])');
                    if (userEl) {
                        username = userEl.getAttribute('href').replace('/@', '').replace('/', '');
                    } else {
                        // Fallback: try to match from URL
                        // url is like https://www.threads.net/@username/post/ID
                        const match = url.match(/@([^/]+)/);
                        if (match) username = match[1];
                    }

                    // Extract Timestamp
                    let timeVal = 0;
                    const timeEl = container.querySelector('time');
                    if (timeEl && timeEl.getAttribute('datetime')) {
                        timeVal = new Date(timeEl.getAttribute('datetime')).getTime() / 1000;
                    }

                    results.push({
                        id: id,
                        text: text,
                        username: username,
                        url: url,
                        timestamp: timeVal,
                        isDOM: true,
                        source_type: 'DOM'
                    });
                });
                return results;
            });

            keywordPosts = keywordPosts.concat(domPosts);

            // Process found posts
            let newPostsCount = 0;
            for (const post of keywordPosts) {
                if (seenPostIds.has(post.id)) continue;
                seenPostIds.add(post.id);

                // Normalization
                const textRaw = post.text || '';
                const textNorm = normalizeText(textRaw);

                // 1. Strict Keyword Check (Golang)
                if (!isRelevantPost(textNorm)) {
                    continue;
                }

                // 2. Dynamic Date Check (Last 2 Months)
                // If timestamp is known (non-zero), validate it.
                if (post.timestamp > 0) {
                    const postTimeMs = post.timestamp * 1000;
                    if (postTimeMs < CUTOFF_DATE) {
                        continue;
                    }
                } else {
                    // If unknown, KEEP it if content matches text search (which it does via isRelevantPost)
                }

                newPostsCount++;
                loadedPostsForKeyword++;

                const location = extractLocation(textRaw);
                const salary = extractSalary(textRaw);
                const isFresher = textNorm.match(/(fresher|junior|intern|thuc tap|moi ra truong)/i) !== null;
                const formattedDate = formatExactDate(post.timestamp);
                const matchScore = calculateInternalScore(textRaw, isFresher, salary, location);

                jobs.push({
                    title: textRaw.split('\n')[0].slice(0, 100) || 'Golang Opportunity',
                    company: `@${post.username}`,
                    url: post.url || `https://threads.net/search?q=${encodeURIComponent(textRaw.slice(0, 20))}`,
                    preview: textRaw.slice(0, 200).trim(),
                    salary: salary,
                    location: location,
                    source: 'Threads',
                    techStack: 'Golang',
                    postedDate: formattedDate,
                    matchScore: matchScore,
                    isFresher: isFresher
                });
            }

            if (newPostsCount > 0) {
                console.log(`    ⬇️  Filtered & verified ${newPostsCount} relevant posts (Total: ${loadedPostsForKeyword})`);
                noChangeCount = 0;
            } else {
                noChangeCount++;
            }

            if (loadedPostsForKeyword >= TARGET_POSTS_PER_KEYWORD) {
                console.log(`    ✅ Reached target of ${TARGET_POSTS_PER_KEYWORD} posts.`);
                break;
            }

            if (noChangeCount >= 5) {
                console.log('    🛑 No new relevant posts found after multiple scrolls, stopping.');
                break;
            }

            await humanScroll(page);
            await randomDelay(4000, 6000);

            const currentHeight = await page.evaluate(() => document.body.scrollHeight);
            if (currentHeight === previousHeight) {
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await randomDelay(2000, 3000);
            }
            previousHeight = currentHeight;
        }

    } catch (error) {
        console.error(`  ❌ Error searching "${keyword}": ${error.message}`);
    } finally {
        page.removeListener('response', responseListener);
    }

    return jobs;
}

/**
 * Scrape Threads in PARALLEL mode (Multi-tab)
 */
async function scrapeThreadsParallel(context, reporter) {
    console.log('🧵 Starting Parallel Threads Scraping...');
    const keywords = ['golang', 'fresher golang', 'junior golang', 'golang developer'];

    const results = await Promise.all(keywords.map(async (keyword) => {
        let page = null;
        try {
            page = await context.newPage();
            return await scrapeKeyword(page, keyword, reporter);
        } catch (error) {
            console.error(`❌ Error in parallel worker for "${keyword}":`, error);
            return [];
        } finally {
            if (page) await page.close();
        }
    }));

    const allJobs = results.flat();
    const uniqueJobs = [...new Map(allJobs.map(j => [j.url, j])).values()];

    console.log(`\n✅ [Parallel] Finished. Found ${uniqueJobs.length} unique jobs total.`);
    return uniqueJobs;
}

async function scrapeThreads(page, reporter, customKeywords = null) {
    console.log('🧵 Searching Threads (Serial)...');

    // --- LOGIN CHECK / SESSION RESTORE ---
    try {
        console.log('  🔐 Checking authentication status...');
        await page.goto('https://www.threads.net/', { waitUntil: 'domcontentloaded' });
        await randomDelay(2000, 3000);

        // Check for "Log in" or "Log in with Instagram" buttons
        // Target specific Instagram login block based on user provided HTML structure
        // Looking for "Tiếp tục bằng Instagram" or "Continue with Instagram" inside a role="button" or clickable div
        const instaLoginBlock = page.locator('div[role="button"]').filter({ hasText: /Tiếp tục bằng Instagram|Continue with Instagram|Log in with Instagram/i }).first();

        if (await instaLoginBlock.count() > 0) {
            console.log('  👆 Found Instagram Login block, clicking...');
            await instaLoginBlock.click();
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
            await randomDelay(3000, 5000);
        } else {
            // Fallback to standard buttons
            const loginButtons = await page.getByRole('button', { name: /Log in|Tiếp tục|Continue/i }).all();
            for (const btn of loginButtons) {
                const text = await btn.innerText();
                if (text.includes('Instagram') || (text.includes('Tiếp tục') && text.includes('Instagram')) || (text.includes('Continue') && text.includes('Instagram'))) {
                    console.log(`  👆 Clicking login button: "${text}"`);
                    await btn.click();
                    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
                    await randomDelay(3000, 5000);
                    break;
                }
            }
        }

    } catch (e) {
        console.log(`  ⚠️ Login check failed: ${e.message}`);
    }
    // --- END LOGIN CHECK ---

    const defaultKeywords = ['golang', 'fresher golang', 'junior golang', 'golang developer'];
    const keywords = customKeywords || defaultKeywords;

    const allJobs = [];
    for (const keyword of keywords) {
        try {
            const jobs = await scrapeKeyword(page, keyword, reporter);
            allJobs.push(...jobs);
        } catch (error) {
            console.error(`  ❌ Error processing "${keyword}": ${error.message}`);
        }
    }

    const uniqueJobs = [...new Map(allJobs.map(j => [j.url, j])).values()];
    return uniqueJobs;
}

module.exports = { scrapeThreads, scrapeThreadsParallel };
