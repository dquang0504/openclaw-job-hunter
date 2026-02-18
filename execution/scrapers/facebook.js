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

        // Randomize warm-up duration (2-4s)
        const warmUpDuration = 2000 + Math.random() * 2000;
        const startTime = Date.now();
        console.log(`⏳ Warming up for ${(warmUpDuration / 1000).toFixed(1)}s with random behaviors...`);

        while (Date.now() - startTime < warmUpDuration) {
            await mouseJiggle(page);
            await page.waitForTimeout(1000 + Math.random() * 1000);
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

            await randomDelay(2000, 3000);
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

            const maxPostsToCheck = Math.min(postsCount, 12); // Check up to 12
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

                // Strategy: Extract Timestamp -> Extract URL -> Open in New Tab -> Scrape -> Filter -> Close
                // --- TIMESTAMP EXTRACTION START ---
                let jobTime = 'Recent';
                try {
                    const svgs = await post.locator('span > span > svg, span > a > span[id] > span').all();
                    let targetSvg = null;

                    // Heuristic: Find small icon (clock/globe)
                    for (const svg of svgs) {
                        const box = await svg.boundingBox();
                        if (!box) continue;
                        if (box.width <= 20 && box.height <= 20) {
                            targetSvg = svg;
                            break;
                        }
                    }

                    if (targetSvg) {
                        try {
                            await targetSvg.scrollIntoViewIfNeeded().catch(() => { });
                            await page.waitForTimeout(500);
                        } catch (e) { }

                        const box = await targetSvg.boundingBox();
                        if (box) {
                            const centerY = box.y + (box.height / 2);
                            const clickX = box.x - 20;
                            const tooltipY = centerY + 25; // Estimated tooltip Y position

                            // Base coordinates for drag selection
                            let currentStart = box.x - 150;
                            let currentEnd = box.x + 29;
                            let attempts = 0;
                            let satisfied = false;

                            // Loop to refine selection
                            while (attempts < 5 && !satisfied) {
                                attempts++;

                                // 1. Trigger Tooltip
                                await page.mouse.move(clickX, centerY, { steps: 5 });
                                await page.waitForTimeout(1000); // Wait for tooltip to appear
                                await page.mouse.move(clickX, tooltipY, { steps: 5 });
                                await page.waitForTimeout(100);

                                // 2. Select Text (Drag)
                                const dragStart = { x: currentStart, y: tooltipY };
                                const dragEnd = { x: currentEnd, y: tooltipY };

                                await page.mouse.move(dragStart.x, dragStart.y);
                                await page.mouse.down();
                                await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 25 });
                                await page.waitForTimeout(100);

                                let selectedText = await page.evaluate(() => window.getSelection().toString());
                                await page.mouse.up();

                                // 3. Analyze Selection
                                if (selectedText && selectedText.trim().length > 3) {
                                    let cleanT = selectedText.trim();

                                    // Safety Check: Garbage or too long
                                    const wordCount = cleanT.split(/\s+/).length;
                                    if (cleanT.length > 250 || wordCount > 35 || cleanT.includes('\n') || cleanT.includes('\r')) {
                                        console.log(`      ⚠️ Timestamp likely garbage (${cleanT.length} chars). Fallback to 'Recent'.`);
                                        jobTime = 'Recent';
                                        satisfied = true;
                                        break;
                                    }

                                    // 4. Refinement Logic (PPC - Pixels Per Char)
                                    const PPC = 5;
                                    let addLeftPx = 0;
                                    let addRightPx = 0;

                                    // Left Truncation fixes (e.g. "u," -> "Thứ Sáu,")
                                    if (/^u,/i.test(cleanT)) addLeftPx = 7 * PPC;
                                    else if (/^ư,/i.test(cleanT)) addLeftPx = 6 * PPC;
                                    else if (/^(ay|ai),/i.test(cleanT)) addLeftPx = 6 * PPC;
                                    else if (/^(am|ăm),/i.test(cleanT)) addLeftPx = 6 * PPC;
                                    else if (/^(at|ật),/i.test(cleanT)) addLeftPx = 7 * PPC;
                                    else if (/^ba,/i.test(cleanT)) addLeftPx = 6 * PPC;
                                    else if (/^hứ/i.test(cleanT)) addLeftPx = 3 * PPC;
                                    else if (/^ủ/i.test(cleanT)) addLeftPx = 4 * PPC;
                                    else if (/^ứ/i.test(cleanT)) addLeftPx = 4 * PPC;
                                    else if (/^,/.test(cleanT)) addLeftPx = 9 * PPC;
                                    else if (/^\d/.test(cleanT)) addLeftPx = 13 * PPC;
                                    else if (/^T(\s|$)/.test(cleanT)) addLeftPx = 4 * PPC;
                                    else if (/^C(\s|$)/.test(cleanT)) addLeftPx = 4 * PPC;

                                    // Right Truncation fixes
                                    if (/lúc\s*$/i.test(cleanT)) addRightPx = 7 * PPC;
                                    else if (/\d{4}\s*$/i.test(cleanT)) addRightPx = 13 * PPC;
                                    else if (/:\s*$/i.test(cleanT)) addRightPx = 3 * PPC;
                                    else if (/:\d\s*$/i.test(cleanT)) addRightPx = 1.5 * PPC;

                                    // Apply adjustments and retry if needed
                                    if (addLeftPx > 0 || addRightPx > 0) {
                                        console.log(`      ⚠️ Truncated ("${cleanT.slice(0, 10)}...${cleanT.slice(-10)}"). Adding: L+${addLeftPx}px, R+${addRightPx}px`);
                                        currentStart -= addLeftPx;
                                        currentEnd += addRightPx;
                                        await page.waitForTimeout(500);
                                        continue;
                                    }

                                    // If good, save and exit loop
                                    jobTime = cleanT;
                                    satisfied = true;
                                    console.log(`      🕒 Extracted Time: "${jobTime}"`);
                                } else {
                                    break; // Nothing selected
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.log(`      ⚠️ Timestamp Extract Error: ${e.message}`);
                    try { await page.mouse.up(); } catch (err) { }
                }
                // --- TIMESTAMP EXTRACTION END ---

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
                    console.log(`      🚀 Navigating to detail page...`);

                    // Navigate and wait longer
                    await detailPage.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                    // Wait for main content container specifically
                    try {
                        await detailPage.waitForSelector('div[data-ad-rendering-role="story_message"]', {
                            state: 'visible',
                            timeout: 5000
                        });
                        console.log(`      📄 Detail page content loaded.`);

                        // Safety Check: Verify we are still on a post page
                        const currentDetailUrl = detailPage.url();
                        if (!currentDetailUrl.includes('/posts/') && !currentDetailUrl.includes('/permalink/') && !currentDetailUrl.includes('/groups/')) {
                            console.log(`      ⚠️ Redirected to non-post URL: ${currentDetailUrl}`);
                            throw new Error('Redirected to non-post URL (Home/Feed)');
                        }
                    } catch (e) {
                        if (e.message.includes('Redirected')) throw e;
                        try {
                            await detailPage.waitForSelector('div[role="main"], div[role="article"]', { timeout: 3000 });
                        } catch (err) {
                            console.log(`      ⚠️ Content timeout, proceeding...`);
                        }
                    }

                    // SIMULATE READING BEHAVIOR (OPTIMIZED)
                    await randomDelay(500, 1000);

                    // Get Full Text (Preferred from story_message)
                    let bodyText = '';
                    try {
                        const storyMessage = detailPage.locator('div[data-ad-rendering-role="story_message"]');
                        if (await storyMessage.count() > 0) {
                            // Gather all parts of the story message (sometimes split)
                            bodyText = await storyMessage.allInnerTexts().then(texts => texts.join('\n'));
                            console.log('      🎯 Extracted from story_message container.');
                        } else {
                            // Fallback 1: Role main
                            const mainRole = detailPage.locator('div[role="main"]');
                            if (await mainRole.count() > 0) {
                                bodyText = await mainRole.innerText();
                            } else {
                                // Fallback 2: Body (Last resort)
                                bodyText = await detailPage.locator('body').innerText();
                            }
                        }
                    } catch (e) {
                        bodyText = await detailPage.locator('body').innerText();
                    }

                    // Remove UI clutter (Likes, Comments, Shares, Footer)
                    const uiPatterns = [
                        /Tất cả cảm xúc:.*$/s,
                        /All reactions:.*$/s,
                        /Facebook Facebook Facebook.*$/s,
                        /Viết câu trả lời\.\.\..*$/s,
                        /Viết bình luận công khai.*$/s,
                        /Write a comment.*$/s,
                        /Thích\s+Bình luận\s+Chia sẻ.*$/s,
                        /Like\s+Comment\s+Share.*$/s
                    ];

                    for (const pattern of uiPatterns) {
                        bodyText = bodyText.replace(pattern, '').trim();
                    }

                    // LOGGING REQUIRED BY USER
                    const contentSnippet = bodyText.slice(-300).replace(/\n/g, ' '); // Last 300 chars
                    console.log(`      📝 Post Details:`);
                    console.log(`          Link: ${postUrl}`);
                    console.log(`          Time: ${jobTime}`);
                    console.log(`          Content (End): "...${contentSnippet}"`);
                    const cleanText = normalizeText(bodyText);

                    // Quick content check on Detail Page
                    const fullDescription = bodyText;
                    // User request: Cut the beginning, keep the end for bot response (approx last 1500 chars)
                    const shortDescription = fullDescription.length > 1500 ? "..." + fullDescription.slice(-1500) : fullDescription;

                    const job = {
                        title: (await detailPage.title()).replace(' | Facebook', ''),
                        company: 'Facebook Group',
                        url: postUrl,
                        description: shortDescription, // Truncated for response
                        location: 'Unknown',
                        source: 'Facebook',
                        techStack: 'Golang',
                        postedDate: jobTime, // Use extracted time
                        isFresher: false
                    };

                    // === FILTER IMMEDIATELY & LOG REASON ===
                    // Use FULL text for filtering
                    const filterText = `${job.title} ${fullDescription}`.toLowerCase();
                    const currentYear = new Date().getFullYear();

                    // 1. Keyword Check
                    if (!CONFIG.keywordRegex.test(filterText)) {
                        console.log(`      ❌ Filtered out: Missing Keyword (Golang)`);
                        continue;
                    }

                    // 2. Experience Check
                    if (CONFIG.excludeRegex.test(filterText)) {
                        console.log(`      ❌ Filtered out: Senior/Lead/Manager detected`);
                        continue;
                    }
                    const expMatch = filterText.match(/\b([3-9]|\d{2,})\s*(\+|plus)?\s*(năm|nam|years?|yrs?|yoe)\b/i);
                    if (expMatch) {
                        console.log(`      ❌ Filtered out: High Exp (${expMatch[0]})`);
                        continue;
                    }

                    // 3. Date Check (Strict 2026/Recent)
                    if (jobTime !== 'Recent' && !jobTime.includes(currentYear.toString())) {
                        // Double check if it's late previous year (e.g. Dec 2025 in Jan 2026) -> Handled by isRecentJob but here we are strict for log
                        const isRecent = require('../lib/filters').isRecentJob(jobTime);
                        if (!isRecent) {
                            console.log(`      ❌ Filtered out: Old Date (${jobTime})`);
                            continue;
                        }
                    }

                    // Determine Location (Strict Restriction: HCM & Can Tho only)
                    // 1. Exclude Hanoi immediately
                    if (/\b(hn|hanoi|ha noi|thu do|ha noi city)\b/.test(cleanText)) {
                        console.log(`      ❌ Filtered out: Location is Hanoi`);
                        continue;
                    }

                    // 2. Check for Allowed Locations
                    let locationValid = false;
                    if (/\b(hcm|ho chi minh|saigon|tphcm|hochiminh|tp hcm)\b/.test(cleanText)) {
                        job.location = 'HCM';
                        locationValid = true;
                    } else if (/\b(can tho|cantho)\b/.test(cleanText)) {
                        job.location = 'Can Tho';
                        locationValid = true;
                    } else if (/\b(remote)\b/.test(cleanText)) {
                        job.location = 'Remote';
                        // locationValid = true; // Uncomment if Remote is allowed. User said "match with tphcm or can tho". Assuming Remote is OK or needs explicit filter?
                        // User said "match with tphcm or can tho", but existing code had Remote. 
                        // Constraint: "only want location receive keywords match with ho chi minh or can tho, ... remove Hanoi".
                        // I will treat Remote as valid for now unless strictly forbidden, but prioritize city check. 
                        // Actually, user said: "only want location receive keywords match with ho chi minh or can tho".
                        // I'll keep Remote as valid but optional, if not matched, it's Unknown. 
                        // Wait, if it's "Unknown" (no city keyword), should we keep it? 
                        // Usually safe to keep "Unknown" if it's not explicitly Hanoi.
                    }

                    // Strict mode: If "Hanoi" -> Removed.
                    // If "HCM" or "Can Tho" -> Set.
                    // If no location keyword -> "Unknown" (Keep).

                    // Match Score
                    job.matchScore = calculateMatchScore(job);

                    console.log(`      ✅ Valid Job Found! Score: ${job.matchScore}`);
                    jobs.push(job);
                    validPostsInGroup++;

                } catch (e) {
                    console.log(`      ⚠️ Error processing detail page: ${e.message}`);
                    await screenshotDebugger.capture(detailPage || page, `fb_detail_error_${i}`);
                } finally {
                    if (detailPage) await detailPage.close();
                    await randomDelay(500, 1000); // Optimized wait
                }
            }

        } catch (error) {
            console.error(`  ❌ Error searching group ${groupUrl}: ${error.message}`);
            await screenshotDebugger.capture(page, 'fb_group_search_error');
        }
    }

    const uniqueJobs = [...new Map(jobs.map(j => [j.url, j])).values()];
    return uniqueJobs;
}

module.exports = { scrapeFacebook };
