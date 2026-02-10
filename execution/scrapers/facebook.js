/**
 * Facebook Group Scraper (Authenticated Search)
 */

const CONFIG = require('../config');
const { randomDelay, humanScroll, mouseJiggle, applyStealthSettings } = require('../lib/stealth');
const { calculateMatchScore } = require('../lib/filters');

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
            // Keep less scroll to avoid crazy DOM size
            await humanScroll(page, 3);
            await randomDelay(2000, 4000);

            // UPDATED: Broad Selector Strategy to Catch Nested Posts
            // Facebook search results structure varies greatly.
            // div[role="feed"] > div is usually good for Feed items
            // div[role="article"] is specific for Posts
            // Also try generic containers if specific ones fail
            let postSelector = 'div[role="feed"] > div, div[role="article"]';

            // Wait specifically for feed or article
            try {
                await page.waitForSelector('div[role="feed"], div[role="article"]', { timeout: 10000 });
            } catch (e) {
                console.log('  ⚠️ Post selector not found (might be no results or layout change)');
            }

            const posts = await page.locator(postSelector).all();
            console.log(`  📄 Found ${posts.length} visible posts`);

            // We'll try to collect up to 3 valid posts, checking up to 15 sections (increased from 10)
            const maxValidPosts = 3;
            // Scan more items because "feed > div" might include headers/spacers
            const maxAttempts = Math.min(15, posts.length);
            let validPostsCount = 0;

            for (let i = 0; i < maxAttempts && validPostsCount < maxValidPosts; i++) {
                const post = posts[i];
                try {
                    // Extract Text and HTML for profile detection

                    // IMPROVED TEXT EXTRACTION:
                    // Priority 1: Use 'userContent' or specific message div if possible (often has dir="auto")
                    // Priority 2: Full text of container
                    let textRaw = '';
                    const messageEl = post.locator('div[data-ad-preview="message"], div[dir="auto"]').first();

                    if (await messageEl.count() > 0) {
                        textRaw = await messageEl.innerText().catch(() => '');
                    }

                    // Fallback to full text if message part is empty or huge (like entire sidebar included)
                    if (!textRaw || textRaw.length < 5) {
                        textRaw = await post.innerText().catch(() => '');
                    }

                    const outerHtml = await post.evaluate(el => el.outerHTML).catch(() => '');

                    // 🚫 PROFILE DETECTION: Skip if this is a member profile, not a post
                    // "Add friend", "Follow", "View profile" usually indicate user card, NOT post
                    // But be careful: a post MIGHT show author profile link.
                    // Check for "Add Friend" button specifically
                    if (outerHtml.includes('aria-label="Add friend"') || outerHtml.includes('aria-label="Add Friend"')) {
                        // console.log(`    ⏭️ Skipping member profile`);
                        continue;
                    }

                    // No minimum text length requirement - even short quality posts are valuable!
                    if (!textRaw || textRaw.trim().length === 0) continue;

                    const textNorm = normalizeText(textRaw);

                    // 1. Strict Keyword Filter (Golang Only)
                    // If normalize fails to find golang, skip.
                    if (!CONFIG.keywordRegex.test(textNorm) && !textNorm.includes('golang')) continue;

                    // 2.5. BOOST: Prioritize fresher/intern/junior posts (includeRegex)
                    const isFresherPost = CONFIG.includeRegex.test(textNorm);
                    if (isFresherPost) {
                        console.log(`    🎯 FRESHER/JUNIOR post detected!`);
                    }

                    // 4. Dynamic Date Heuristic (Last 2 Months)
                    // Skip if post seems to be from > 2 months ago
                    // Heuristic: Check for text like "3 months ago", "1 year ago", "2023", "2022"
                    // Also check for explicit old years in text (e.g. "posted in 2023")

                    const timeTextRegexSkip = /\b(\d+)\s+(months?|tháng|years?|năm)\s+(ago|trước)\b/i;
                    const matchTime = textRaw.match(timeTextRegexSkip);
                    if (matchTime) {
                        const num = parseInt(matchTime[1]);
                        const unit = matchTime[2].toLowerCase();
                        if (unit.includes('year') || unit.includes('năm')) {
                            console.log(`    ⏭️ Skipping old post (Year detected: ${num} ${unit})`);
                            continue;
                        }
                        if ((unit.includes('month') || unit.includes('tháng')) && num > 2) {
                            console.log(`    ⏭️ Skipping old post (> 2 months: ${num} ${unit})`);
                            continue;
                        }
                    }

                    const currentYear = new Date().getFullYear();
                    // Skip if explicit older year mentioned (e.g. 2024 if currently 2026, 2023, etc.)
                    // BUT be careful not to skip current year.
                    // If we are in 2026, skip 2025 and older? No, only allow last 2 months. 
                    // So if current is Feb 2026, allow Dec 2025.
                    // Simple heuristic: block year - 2 and older.
                    const oldYearPattern = new RegExp(`\\b(${currentYear - 2}|${currentYear - 3})\\b`);
                    if (oldYearPattern.test(textNorm)) {
                        console.log(`    ⏭️ Skipping old post (found previous year)`);
                        continue;
                    }

                    // Extract Post URL (Permalink) - Robust Method
                    // Strategy: Iterate ALL links in the post container and score them based on Aria Label, Href Pattern, and Text.
                    let postUrl = cleanGroupUrl;
                    let bestMatchUrl = '';
                    let bestMatchScore = 0; // Higher is better
                    let foundDate = null; // Store detected date for filtering

                    try {
                        const links = await post.locator('a[href]').all();

                        // Timestamp Regex Patterns for Text/Aria-Label
                        const timeRegex = /^(vừa xong|just now|hôm qua|yesterday|\d+\s+(giờ|phút|ngày|tháng|năm|hr|hrs|min|mins|day|days|h|m|y)|[a-zA-Z]{3,9}\s+\d{1,2}(,|\sat)?)/i;

                        for (const link of links) {
                            let score = 0;
                            const href = await link.getAttribute('href');
                            const ariaLabel = await link.getAttribute('aria-label') || '';
                            const text = await link.innerText().catch(() => '');

                            if (!href || href === '#' || href.startsWith('javascript:')) continue;

                            // 1. HREF Pattern (Strongest Signal for Identity)
                            if (href.includes('/posts/') || href.includes('/permalink/')) {
                                score += 10;
                            } else if (href.match(/\/groups\/\d+\/user\/\d+/)) {
                                score += 2;
                            } else if (href.includes('/groups/') && href.length > 50) {
                                score += 1;
                            }

                            // 2. Aria Label (Strong Signal for Intent)
                            // Facebook often puts the full date in aria-label of the timestamp link
                            if (ariaLabel && (timeRegex.test(ariaLabel) || ariaLabel.length > 10 && ariaLabel.match(/\d{1,2}/))) {
                                score += 5;
                                // Try parse date
                                const d = new Date(ariaLabel);
                                if (!isNaN(d.getTime())) {
                                    foundDate = d;
                                }
                            }

                            // 3. Text Content (Fallback Signal)
                            if (text && text.trim().length > 0 && timeRegex.test(text.trim())) {
                                score += 3;
                            }

                            if (score > bestMatchScore) {
                                bestMatchScore = score;
                                bestMatchUrl = href;
                            }
                        }

                        // STRICT DATE FILTERING if we found a valid date in aria-label
                        if (foundDate) {
                            const cutoffDate = new Date();
                            cutoffDate.setMonth(cutoffDate.getMonth() - 2); // 2 months ago

                            if (foundDate < cutoffDate) {
                                console.log(`    ⏭️ Skipping old post (Date in aria-label: ${foundDate.toLocaleDateString()})`);
                                continue;
                            }
                        }

                        if (bestMatchUrl && bestMatchScore >= 3) {
                            const baseUrl = 'https://www.facebook.com';
                            let fullUrl = bestMatchUrl.startsWith('http') ? bestMatchUrl : `${baseUrl}${bestMatchUrl}`;

                            // Fix double slashes
                            fullUrl = fullUrl.replace(/([^:]\/)\/+/g, "$1");

                            // Clean URL
                            if (!fullUrl.includes('permalink.php')) {
                                fullUrl = fullUrl.split('?')[0];
                            }
                            postUrl = fullUrl;
                        }

                    } catch (e) {
                        // keep default group URL
                    }

                    // Determine location for job object (without filtering)
                    let location = 'Unknown';
                    if (textNorm.includes('remote') || textNorm.includes('tu xa') || textNorm.includes('online')) {
                        location = 'Remote';
                    } else if (textNorm.includes('can tho')) {
                        location = 'Cần Thơ';
                    } else if (textNorm.includes('ha noi') || textNorm.includes('ho chi minh') || textNorm.includes('hcm') || textNorm.includes('saigon')) {
                        location = 'Hanoi/HCM';
                    }

                    const job = {
                        title: textRaw.split('\n')[0].slice(0, 100), // First line as title
                        company: 'Facebook Group',
                        url: postUrl, // Use extracted permalink or group URL fallback
                        preview: textRaw.slice(0, 100).trim(), // Preview text for manual search
                        salary: 'Negotiable',
                        location: location, // Use detected location
                        source: 'Facebook',
                        techStack: 'Golang',
                        description: textRaw.slice(0, 300), // Extract preview text for Telegram
                        postedDate: foundDate ? foundDate.toLocaleDateString() : 'Recent',
                        matchScore: calculateMatchScore({ title: textRaw, location: location.toLowerCase() }),
                        isFresher: isFresherPost // Flag for fresher/junior posts
                    };

                    jobs.push(job);
                    validPostsCount++; // Increment valid posts counter
                    console.log(`    ✅ Potential Post: ${job.title.slice(0, 40)}... (URL: ${job.url})`);

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
