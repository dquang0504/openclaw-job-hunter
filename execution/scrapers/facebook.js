/**
 * Facebook Group Scraper (Authenticated Search)
 */

const CONFIG = require('../config');
const { randomDelay, humanScroll, mouseJiggle, applyStealthSettings, idleBehavior } = require('../lib/stealth');
const { analyzeLocation, calculateMatchScore, shouldRejectForLevel } = require('../lib/filters');
const ScreenshotDebugger = require('../lib/screenshot');
const { extractDateCandidate, getJobFreshnessInfo } = require('../utils/date');

/**
 * Helper: Normalize text to handle fancy fonts and accents
 */
const normalizeText = (text) => (text || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function getFreshnessInfo(dateText, allowUnknownRecent = false) {
    return getJobFreshnessInfo(dateText, {
        freshnessDays: CONFIG.jobFreshnessDays,
        allowUnknownRecent
    });
}

async function resolveFacebookPostDate(detailPage, fallbackTime) {
    const fallbackInfo = getFreshnessInfo(fallbackTime, false);
    if (fallbackInfo.isKnown) {
        return fallbackTime;
    }

    const candidateTexts = await detailPage.evaluate(() => {
        const values = [];
        const seen = new Set();

        const push = (value) => {
            const clean = (value || '').replace(/\s+/g, ' ').trim();
            if (!clean || clean.length > 140 || seen.has(clean)) return;
            seen.add(clean);
            values.push(clean);
        };

        document.querySelectorAll('a[aria-label], span[aria-label], div[aria-label]').forEach((element) => {
            push(element.getAttribute('aria-label'));
        });

        document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="/groups/"]').forEach((element) => {
            push(element.textContent);
            push(element.getAttribute('aria-label'));
        });

        return values.slice(0, 200);
    });

    for (const candidateText of candidateTexts) {
        const candidate = extractDateCandidate(candidateText) || candidateText;
        const info = getFreshnessInfo(candidate, false);
        if (info.isKnown) {
            if (candidate !== fallbackTime) {
                console.log(`      🕒 Resolved detail timestamp: "${candidate}"`);
            }
            return candidate;
        }
    }

    return fallbackTime;
}

async function waitForFacebookDetailReady(detailPage) {
    const detailSignals = [
        'div[data-ad-rendering-role="story_message"]',
        'div[role="article"]',
        'div[role="main"]'
    ];

    const start = Date.now();
    let lastSnapshot = '';
    let stableReads = 0;

    while (Date.now() - start < 8000) {
        for (const selector of detailSignals) {
            const locator = detailPage.locator(selector).first();
            if (await locator.count() === 0) continue;

            const text = (await locator.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
            if (!text || text.length < 80) continue;

            if (text === lastSnapshot) {
                stableReads += 1;
            } else {
                lastSnapshot = text;
                stableReads = 1;
            }

            if (stableReads >= 2) {
                return true;
            }
        }

        await detailPage.waitForTimeout(750);
    }

    return false;
}

/**
 * Scrape Facebook Groups using authenticated Search URL
 * @param {import('playwright').Page} page
 * @param {import('../lib/telegram')} reporter
 */
async function scrapeFacebook(page, reporter, seenJobs = new Set(), options = {}) {
    console.log('📘 Searching Facebook Groups (Authenticated)...');

    // Ensure stealth settings are active
    await applyStealthSettings(page);

    const screenshotDebugger = new ScreenshotDebugger(reporter);
    const jobs = [];
    const staleUrls = new Set();
    const context = page.context();
    const searchKeyword = 'golang';
    const maxPostsPerGroup = options.maxPostsPerGroup || 15;
    const maxNewJobsPerGroup = options.maxNewJobsPerGroup || 5;
    const searchSettleMinMs = options.searchSettleMinMs || 3500;
    const searchSettleMaxMs = options.searchSettleMaxMs || 6500;
    const preOpenPostMinMs = options.preOpenPostMinMs || 1200;
    const preOpenPostMaxMs = options.preOpenPostMaxMs || 2800;
    const detailReadMinMs = options.detailReadMinMs || 1500;
    const detailReadMaxMs = options.detailReadMaxMs || 3200;
    const groupCooldownMinMs = options.groupCooldownMinMs || 8000;
    const groupCooldownMaxMs = options.groupCooldownMaxMs || 15000;
    const warmupMinMs = options.warmupMinMs || 4000;
    const warmupMaxMs = options.warmupMaxMs || 8000;
    const warmupOnStart = options.warmupOnStart !== false;
    const groupsToScan = options.groups || CONFIG.facebookGroups;
    let authIssueDetected = false;
    let scannedPosts = 0;
    const warnings = [];

    // --- WARM UP PHASE ---
    if (warmupOnStart) {
        try {
            console.log('🏠 Navigating to Facebook Home for warm-up...');
            await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });

            const warmUpDuration = warmupMinMs + Math.random() * Math.max(0, warmupMaxMs - warmupMinMs);
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
    } else {
        console.log('⏭️ Reusing warmed Facebook session for next group.');
    }
    // --- END WARM UP ---

    // Filter for 2026: start_year:2026, end_year:2026
    const RECENT_POSTS_FILTER = 'eyJyZWNlbnRfcG9zdHM6MCI6IntcIm5hbWVcIjpcInJlY2VudF9wb3N0c1wiLFwiYXJnc1wiOlwiXCJ9IiwicnBfY3JlYXRpb25fdGltZTowIjoie1wibmFtZVwiOlwiY3JlYXRpb25fdGltZVwiLFwiYXJnc1wiOlwie1xcXCJzdGFydF95ZWFyXFxcIjpcXFwiMjAyNlxcXCIsXFxcInN0YXJ0X21vbnRoXFxcIjpcXFwiMjAyNi0xXFxcIixcXFwiZW5kX3llYXJcXFwiOlxcXCIyMDI2XFxcIixcXFwiZW5kX21vbnRoXFxcIjpcXFwiMjAyNi0xMlxcXCIsXFxcInN0YXJ0X2RheVxcXCI6XFxcIjIwMjYtMS0xXFxcIixcXFwiZW5kX2RheVxcXCI6XFxcIjIwMjYtMTItMzFcXFwifVwifSJ9';

    for (const groupUrl of groupsToScan) {
        if (authIssueDetected) break;
        try {
            const cleanGroupUrl = groupUrl.replace(/\/$/, '')
                .replace('mbasic.facebook.com', 'www.facebook.com')
                .replace('m.facebook.com', 'www.facebook.com');
            const processedUrls = new Set();
            let validPostsInGroup = 0;

            const searchUrl = `${cleanGroupUrl}/search?q=${encodeURIComponent(searchKeyword)}&filters=${RECENT_POSTS_FILTER}`;

            console.log(`  👥 Visiting Group Search: ${cleanGroupUrl} | keyword="${searchKeyword}"`);

            await page.setExtraHTTPHeaders({ 'Referer': cleanGroupUrl });
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.setExtraHTTPHeaders({});

            await randomDelay(searchSettleMinMs, searchSettleMaxMs);
            await mouseJiggle(page);
            await idleBehavior(page);

            // Check for Blocked/Login
            if (page.url().includes('checkpoint') || await page.locator('input[name="email"]').count() > 0) {
                console.log('  ⛔ Checkpoint/Login detected. Skipping.');
                await screenshotDebugger.captureAuthIssue(page, 'facebook', `Checkpoint/Login detected while opening ${cleanGroupUrl}`);
                await reporter.sendStatus('⚠️ Facebook scraper skipped because the session looks expired or needs login.');
                warnings.push(`Auth issue detected while opening group ${cleanGroupUrl}`);
                authIssueDetected = true;
                break;
            }

            // Scroll to load posts
            console.log('    ⏳ Loading posts...');
            await humanScroll(page, 5);
            await idleBehavior(page);
            await randomDelay(3000, 5000);

            // Desktop Selectors
            const postSelector = 'div[role="feed"] > div, div[role="article"]';
            const postsCount = await page.locator(postSelector).count();
            console.log(`    📄 Found ${postsCount} potential posts in feed.`);

            // Stop when either:
            // 1. we found enough new valid jobs in this group, or
            // 2. we scanned the hard limit configured for this group.
            const maxPostsToCheck = Math.min(postsCount, maxPostsPerGroup);

            for (let i = 0; i < maxPostsToCheck; i++) {
                if (validPostsInGroup >= maxNewJobsPerGroup) break; // Found enough new valid jobs for this group
                scannedPosts++;

                // Scroll to item
                const post = page.locator(postSelector).nth(i);
                if (await post.isVisible()) {
                    await post.scrollIntoViewIfNeeded();
                    await page.waitForTimeout(500); // Settle
                }
                await idleBehavior(page);
                await randomDelay(preOpenPostMinMs, preOpenPostMaxMs);

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
                                    const PPC = 3;
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

                    // --- EARLY CONTENT CHECK (OPTIMIZATION) ---
                    let earlyText = '';
                    try {
                        earlyText = await post.innerText();
                        const cleanEarlyText = normalizeText(earlyText);

                        // 1. Check Exclusions (Senior/Manager/etc)
                        if (shouldRejectForLevel(cleanEarlyText)) {
                            console.log(`      ❌ [Early] Filtered out: Senior/Lead/Manager detected`);
                            continue;
                        }

                        const earlyLocation = analyzeLocation(cleanEarlyText);
                        if (earlyLocation.isHanoiOnly) {
                            console.log(`      ❌ [Early] Filtered out: Location is Hanoi (and no others)`);
                            continue;
                        }
                    } catch (e) {
                        // Ignore errors, proceed to deep scrape
                    }
                    // --- END EARLY CHECK ---

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

                    // GLOBAL DEDUP CHECK
                    if (seenJobs.has(postUrl)) {
                    // console.log(`      ⏩ Skipped (Global Dedup): ${postUrl}`);
                        processedUrls.add(postUrl); // Mark processed to avoid re-checking in same run
                        continue;
                    }

                    processedUrls.add(postUrl);

                    const feedFreshness = getFreshnessInfo(jobTime, false);
                    if (feedFreshness.isKnown && feedFreshness.isStale) {
                        staleUrls.add(postUrl);
                        console.log(`      🗂️ Marked stale from feed date (${jobTime})`);
                        continue;
                    }

                    console.log(`    🔍 Inspecting Post ${i + 1}/${maxPostsToCheck}: ${postUrl}`);

                    // OPEN NEW TAB
                    let detailPage = null;
                    try {
                    detailPage = await context.newPage();
                    console.log(`      🚀 Navigating to detail page...`);

                    // Navigate and wait longer
                    await detailPage.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await detailPage.waitForTimeout(1500);

                    if (detailPage.url().includes('checkpoint') || await detailPage.locator('input[name="email"]').count() > 0) {
                        authIssueDetected = true;
                        warnings.push(`Auth issue detected while opening post detail ${postUrl}`);
                        await screenshotDebugger.captureAuthIssue(detailPage, 'facebook', `Checkpoint/Login detected while opening post detail ${postUrl}`);
                        await reporter.sendStatus('⚠️ Facebook scraper skipped because the session expired while opening a post detail.');
                        break;
                    }

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

                    const detailSettled = await waitForFacebookDetailReady(detailPage);
                    if (!detailSettled) {
                        console.log('      ⚠️ Detail content did not fully stabilize before extraction.');
                    } else {
                        console.log('      ⏳ Detail content stabilized.');
                    }

                    await mouseJiggle(detailPage);
                    await idleBehavior(detailPage);
                    await randomDelay(detailReadMinMs, detailReadMaxMs);

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

                    // Remove duplicate/noisy prefix from homepage truncation ("... Xem thêm" / "... See more")
                    const noiseRegex = /(?:\.\.\.|…)\s*(?:Xem thêm|See more)/gi;
                    const noiseMatches = [...bodyText.matchAll(noiseRegex)];
                    if (noiseMatches.length > 0) {
                        const lastMatch = noiseMatches[noiseMatches.length - 1];
                        const cutoffIndex = lastMatch.index + lastMatch[0].length;
                        bodyText = bodyText.slice(cutoffIndex).trim();
                        console.log(`      ✂️ Truncated noise up to "${lastMatch[0]}".`);
                    }

                    jobTime = await resolveFacebookPostDate(detailPage, jobTime);
                    const detailFreshness = getFreshnessInfo(jobTime, false);
                    if (detailFreshness.isKnown && detailFreshness.isStale) {
                        staleUrls.add(postUrl);
                        console.log(`      🗂️ Marked stale from detail date (${jobTime})`);
                        continue;
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
                    // 1. Keyword Check
                    if (!CONFIG.keywordRegex.test(filterText)) {
                        console.log(`      ❌ Filtered out: Missing Keyword (Golang)`);
                        continue;
                    }

                    // 2. Experience Check
                    if (shouldRejectForLevel(filterText)) {
                        console.log(`      ❌ Filtered out: Senior/Lead/Manager detected`);
                        continue;
                    }

                    // 3. Date Check (strict 7-day freshness window)
                    const freshnessInfo = getFreshnessInfo(jobTime, true);
                    if (freshnessInfo.isKnown && !freshnessInfo.isFresh) {
                        staleUrls.add(postUrl);
                        console.log(`      ❌ Filtered out: Old Date (${jobTime})`);
                        continue;
                    }

                    // Determine Location (Updated Logic: Hanoi allowed if valid location also exists)
                    // (cleanText is already defined above)
                    const locationInfo = analyzeLocation(cleanText);

                    // 1. Strict Exclusion: Hanoi ONLY
                    if (locationInfo.isHanoiOnly) {
                        console.log(`      ❌ Filtered out: Location is Hanoi (and no others)`);
                        continue;
                    }

                    // 2. Assign Location
                    if (locationInfo.preferredLocation !== 'Unknown' && locationInfo.preferredLocation !== 'Hanoi') {
                        job.location = locationInfo.preferredLocation;
                    }
                    // Else: Unknown (Keep)

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
                    await randomDelay(1500, 3000);
                }

                if (authIssueDetected) break;
            }
        } catch (error) {
            console.error(`  ❌ Error searching group ${groupUrl}: ${error.message}`);
            await screenshotDebugger.capture(page, 'fb_group_search_error');
        } finally {
            if (!authIssueDetected) {
                await idleBehavior(page);
                await randomDelay(groupCooldownMinMs, groupCooldownMaxMs);
            }
        }
    }

    const uniqueJobs = [...new Map(jobs.map(j => [j.url, j])).values()];
    return {
        jobs: uniqueJobs,
        staleUrls: Array.from(staleUrls),
        status: authIssueDetected ? 'blocked' : 'success',
        warnings,
        metrics: {
            scannedCount: scannedPosts,
            groupCount: groupsToScan.length
        }
    };
}

module.exports = { scrapeFacebook };
