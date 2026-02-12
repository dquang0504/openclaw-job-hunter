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
    const RECENT_POSTS_FILTER = 'eyJyZWNlbnRfcG9zdHM6MCI6IntcIm5hbWVcIjpcInJlY2VudF9wb3N0c1wiLFwiYXJnc1wiOlwiXCJ9IiwicnBfY3JlYXRpb25fdGltZTowIjoie1wibmFtZVwiOlwiY3JlYXRpb25fdGltZVwiLFwiYXJnc1wiOlwie1xcXCJzdGFydF95ZWFyXFxcIjpcXFwiMjAyNlxcXCIsXFxcInN0YXJ0X21vbnRoXFxcIjpcXFwiMjAyNi0xXFxcIixcXFwiZW5kX3llYXJcXFwiOlxcXCIyMDI2XFxcIixcXFwiZW5kX21vbnRoXFxcIjpcXFwiMjAyNi0xMlxcXCIsXFxcInN0YXJ0X2RheVxcXCI6XFxcIjIwMjYtMS0xXFxcIixcXFwiZW5kX2RheVxcXCI6XFxcIjIwMjYtMTItMzFcXFwifVwifSJ9';

    for (const groupUrl of CONFIG.facebookGroups) {
        try {
            // Allow single keyword 'golang' as per config
            const keyword = 'golang';
            const cleanGroupUrl = groupUrl.replace(/\/$/, '').replace('m.facebook.com', 'www.facebook.com');
            const searchUrl = `${cleanGroupUrl}/search?q=${encodeURIComponent(keyword)}&filters=${RECENT_POSTS_FILTER}`;

            console.log(`  👥 Visiting Group: ${cleanGroupUrl}`);

            // 1. Go to Group Home first (more natural)
            try {
                await page.goto(cleanGroupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            } catch (e) {
                console.log(`  ⚠️ Timeout visiting group home, trying search direct...`);
            }

            // Check for Blocked/Login - Strict Check
            const currentUrl = page.url();
            if (currentUrl.includes('/checkpoint/') || currentUrl.includes('/blocked/')) {
                console.log('  ⛔ Redirected to Checkpoint URL. Stopping.');
                await reporter.sendError('Facebook Scraper: Account flagged/blocked (code 403).');
                return [];
            }
            if (await page.getByRole('heading', { name: /Temporarily Blocked|Account Restricted/i }).isVisible()) {
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
            await page.setExtraHTTPHeaders({});

            // 3. Confirm Humanity
            await mouseJiggle(page);
            await randomDelay(3000, 5000);

            if (await page.locator('input[name="email"]').count() > 0) {
                console.log('  🔒 Login wall detected. Cookies might be invalid.');
                continue;
            }
            if (await page.getByText('No results found', { exact: false }).isVisible()) {
                console.log('  ℹ️ No results found for query.');
                continue;
            }

            await humanScroll(page, 3);
            await randomDelay(2000, 4000);

            let postSelector = 'div[role="feed"] > div, div[role="article"]';
            try {
                await page.waitForSelector('div[role="feed"], div[role="article"]', { timeout: 10000 });
            } catch (e) {
                console.log('  ⚠️ Post selector not found (might be no results or layout change)');
            }

            const totalPostsFound = await page.locator(postSelector).count();
            console.log(`  📄 Found ${totalPostsFound} visible posts`);

            const maxValidPosts = 3;
            const maxAttempts = Math.min(15, totalPostsFound);
            let validPostsCount = 0;

            for (let i = 0; i < maxAttempts && validPostsCount < maxValidPosts; i++) {
                // CRITICAL FIX: Re-locate element by index on every iteration.
                const post = page.locator(postSelector).nth(i);

                await page.waitForTimeout(1000); // Stabilize before interacting

                try {
                    let textRaw = '';
                    const messageEl = post.locator('div[data-ad-preview="message"], div[dir="auto"]').first();

                    if (await messageEl.count() > 0) {
                        textRaw = await messageEl.innerText().catch(() => '');
                    }
                    if (!textRaw || textRaw.length < 5) {
                        textRaw = await post.innerText().catch(() => '');
                    }

                    const outerHtml = await post.evaluate(el => el.outerHTML).catch(() => '');
                    if (outerHtml.includes('aria-label="Add friend"') || outerHtml.includes('aria-label="Add Friend"')) {
                        continue;
                    }
                    if (!textRaw || textRaw.trim().length === 0) continue;

                    const textNorm = normalizeText(textRaw);
                    if (!textNorm.includes('golang')) continue;

                    const isFresherOrJunior = CONFIG.includeRegex.test(textNorm) || /fresher|junior|intern|thực tập|trainee|đào tạo|learning|newbie/i.test(textNorm);
                    const isSeniorOrLead = textNorm.includes('senior') || textNorm.includes('lead') || textNorm.includes('manager') || textNorm.includes('trưởng nhóm');
                    const yoeMatch = textRaw.match(/([3-9]|\d{2,})\s*(\+|plus|\s*năm|\s*years?|\s*yoe)/i);

                    if (!isFresherOrJunior) {
                        if (isSeniorOrLead) {
                            console.log(`    ⏭️ Skipping Senior/Lead post: ${textRaw.slice(0, 30)}...`);
                            continue;
                        }
                        if (yoeMatch) {
                            console.log(`    ⏭️ Skipping High YoE post (${yoeMatch[0]}): ${textRaw.slice(0, 30)}...`);
                            continue;
                        }
                    }

                    const jobKeywords = /backend|back-end|developer|engineer|lập trình|coder|dev|phát triển|xây dựng|hệ thống|technical|tech|tuyển|hiring/i;
                    if (!jobKeywords.test(textNorm)) continue;

                    const isFresherPost = isFresherOrJunior;
                    if (isFresherPost) console.log(`    🎯 FRESHER/JUNIOR post detected!`);

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
                    const oldYearPattern = new RegExp(`\\b(${currentYear - 2}|${currentYear - 3})\\b`);
                    if (oldYearPattern.test(textNorm)) {
                        console.log(`    ⏭️ Skipping old post (found previous year)`);
                        continue;
                    }

                    let postUrl = cleanGroupUrl;
                    let clickedSuccess = false;

                    try {
                        const svgs = await post.locator('span > span > svg').all();
                        let targetSvg = null;

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
                                const startUrl = page.url();
                                const clickX = box.x - 20;

                                let extractedTime = 'Recent';
                                try {
                                    const scaledYDelta = 25;
                                    const tooltipY = centerY + scaledYDelta;

                                    // NEW: PRODICTIVE SMART RETRY LOGIC (LOOP ACCUMULATION)
                                    // Base Coordinates (User defined baseline)
                                    let currentStart = box.x - 150; // User baseline
                                    let currentEnd = box.x + 29;    // User baseline
                                    let attempts = 0;
                                    let satisfied = false;

                                    // Increased attempts to allow iterative refinement
                                    while (attempts < 5 && !satisfied) {
                                        attempts++;

                                        // Re-trigger tooltip sequence
                                        await page.mouse.move(clickX, centerY, { steps: 5 });
                                        await page.waitForTimeout(1000);
                                        await page.mouse.move(clickX, tooltipY, { steps: 5 });
                                        await page.waitForTimeout(100);

                                        const dragStart = { x: currentStart, y: tooltipY };
                                        const dragEnd = { x: currentEnd, y: tooltipY };

                                        await page.mouse.move(dragStart.x, dragStart.y);
                                        await page.mouse.down();
                                        await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 25 });
                                        await page.waitForTimeout(100);

                                        let selectedText = await page.evaluate(() => window.getSelection().toString());
                                        await page.mouse.up();

                                        if (selectedText && selectedText.trim().length > 3) {
                                            extractedTime = selectedText.trim();
                                            let cleanT = extractedTime;

                                            // Safety: If too long (> 35 words), or multiple lines, it's likely garbage
                                            const wordCount = cleanT.split(/\s+/).length;
                                            // Relaxed constraints: > 35 words or > 250 chars
                                            if (cleanT.length > 250 || wordCount > 35 || cleanT.includes('\n') || cleanT.includes('\r')) {
                                                console.log(`      ⚠️ Timestamp likely garbage (${cleanT.length} chars, ${wordCount} words). Fallback to 'Recent'.`);
                                                extractedTime = 'Recent';
                                                satisfied = true;
                                                break;
                                            }

                                            // Refinement Logic (Run on every attempt)
                                            const PPC = 5; // Pixels per character (Estimated)
                                            let addLeftPx = 0;
                                            let addRightPx = 0;

                                            // --- Left Truncation Logic ---
                                            // Check for partial starts
                                            if (/^u,/i.test(cleanT)) addLeftPx = 7 * PPC;         // "u," -> "Thứ Sáu," 
                                            else if (/^ư,/i.test(cleanT)) addLeftPx = 6 * PPC;    // "ư," -> "Thứ Tư,"
                                            else if (/^(ay|ai),/i.test(cleanT)) addLeftPx = 6 * PPC; // "ai,"/"ay," -> "Thứ Hai,"/"Thứ Bảy,"
                                            else if (/^(am|ăm),/i.test(cleanT)) addLeftPx = 6 * PPC; // "ăm," -> "Thứ Năm,"
                                            else if (/^(at|ật),/i.test(cleanT)) addLeftPx = 7 * PPC; // "ật," -> "Chủ Nhật,"
                                            else if (/^ba,/i.test(cleanT)) addLeftPx = 6 * PPC;    // "ba," -> "Thứ Ba,"
                                            else if (/^hứ/i.test(cleanT)) addLeftPx = 3 * PPC;     // "hứ" -> "Thứ"
                                            else if (/^ủ/i.test(cleanT)) addLeftPx = 4 * PPC;      // "ủ" -> "Chủ"
                                            else if (/^ứ/i.test(cleanT)) addLeftPx = 4 * PPC;
                                            else if (/^,/.test(cleanT)) addLeftPx = 9 * PPC;
                                            else if (/^\d/.test(cleanT)) addLeftPx = 13 * PPC;
                                            else if (/^T(\s|$)/.test(cleanT)) addLeftPx = 4 * PPC; // "T " -> "Thứ"
                                            else if (/^C(\s|$)/.test(cleanT)) addLeftPx = 4 * PPC; // "C " -> "Chủ"


                                            // --- Right Truncation Logic ---
                                            if (/lúc\s*$/i.test(cleanT)) addRightPx = 7 * PPC;        // Ends with "lúc"
                                            else if (/\d{4}\s*$/i.test(cleanT)) addRightPx = 13 * PPC; // Ends with Year
                                            else if (/:\s*$/i.test(cleanT)) addRightPx = 3 * PPC;     // Ends with ":"
                                            else if (/:\d\s*$/i.test(cleanT)) addRightPx = 1.5 * PPC; // Ends with ":5"

                                            if (addLeftPx > 0 || addRightPx > 0) {
                                                console.log(`      ⚠️ Truncated ("${cleanT.slice(0, 10)}...${cleanT.slice(-10)}"). Adding: L+${addLeftPx}px, R+${addRightPx}px`);
                                                currentStart -= addLeftPx;
                                                currentEnd += addRightPx;

                                                console.log(`      ⏳ Adjustment applied. Retry attempt ${attempts + 1}...`);
                                                await page.waitForTimeout(1000);
                                                continue; // Loop again for next attempt
                                            }

                                            satisfied = true;
                                        } else {
                                            break;
                                        }
                                    }

                                } catch (e) {
                                    console.log(`      ⚠️ Timestamp Extract Failed: ${e.message}`);
                                    try { await page.mouse.up(); } catch (err) { }
                                }

                                console.log(`      🖱️ Smart Scan Final. Time: "${extractedTime}"`);

                                // FORCE PAUSE to prevent "machine gun" clicking
                                console.log('      ⏳ Waiting 2s before clicking link...');
                                await page.waitForTimeout(2000);

                                try {
                                    // CLICK LINK
                                    await page.mouse.move(clickX, centerY, { steps: 5 });
                                    await page.mouse.click(clickX, centerY);
                                    await page.waitForTimeout(1000);

                                    const currentUrl = page.url();
                                    if (currentUrl !== startUrl && (currentUrl.includes('/posts/') || currentUrl.includes('/permalink/'))) {
                                        postUrl = currentUrl;
                                        clickedSuccess = true;
                                        console.log(`      🔗 SUCCESS! Link Clicked. URL: ${currentUrl}`);

                                        await page.goBack();
                                        await page.waitForLoadState('domcontentloaded');
                                        await randomDelay(1000, 2000);
                                    } else {
                                        if (currentUrl !== startUrl) await page.goBack();
                                    }
                                } catch (e) {
                                    console.log(`      ⚠️ Click Action Failed: ${e.message}`);
                                }

                                var jobTime = extractedTime;
                            }
                        }

                    } catch (e) {
                        console.log(`      ⚠️ Click Strategy Error: ${e.message}`);
                    }

                    if (!clickedSuccess) {
                        const links = await post.locator('a[href]').all();
                        let foundPermalink = '';
                        for (const link of links) {
                            const href = await link.getAttribute('href');
                            if (!href) continue;
                            if (href.includes('/posts/') && !href.includes('/user/')) {
                                foundPermalink = href;
                                break;
                            }
                            if (href.includes('/permalink/') && !foundPermalink) foundPermalink = href;
                        }

                        if (foundPermalink) {
                            const baseUrl = 'https://www.facebook.com';
                            let fullUrl = foundPermalink.startsWith('http') ? foundPermalink : `${baseUrl}${foundPermalink}`;
                            fullUrl = fullUrl.replace(/([^:]\/)\/+/g, "$1").split('?')[0];
                            postUrl = fullUrl;
                        } else {
                            for (const link of links) {
                                const href = await link.getAttribute('href');
                                if (href && href.includes('/groups/') && href.length > 50 && !href.includes('/user/')) {
                                    postUrl = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
                                    break;
                                }
                            }
                        }
                    }

                    let location = 'Unknown';
                    if (textNorm.includes('remote') || textNorm.includes('tu xa') || textNorm.includes('online')) location = 'Remote';
                    else if (textNorm.includes('can tho')) location = 'Cần Thơ';
                    else if (textNorm.includes('ha noi') || textNorm.includes('ho chi minh') || textNorm.includes('hcm') || textNorm.includes('saigon')) location = 'Hanoi/HCM';

                    const job = {
                        title: textRaw.split('\n')[0].slice(0, 100),
                        company: 'Facebook Group',
                        url: postUrl,
                        preview: textRaw.slice(0, 100).trim(),
                        salary: 'Negotiable',
                        location: location,
                        source: 'Facebook',
                        techStack: 'Golang',
                        description: textRaw.slice(0, 300),
                        postedDate: (typeof jobTime !== 'undefined' && jobTime !== 'Recent') ? jobTime : 'Recent',
                        matchScore: calculateMatchScore({ title: textRaw, location: location.toLowerCase() }),
                        isFresher: isFresherPost
                    };

                    jobs.push(job);
                    validPostsCount++;
                    console.log(`    ✅ Potential Post: ${job.title.slice(0, 40)}... (URL: ${job.url})`);

                } catch (e) {
                    // skip
                }
            }

        } catch (error) {
            console.error(`  ❌ Error searching group ${groupUrl}: ${error.message}`);
        }

        await randomDelay(1000, 2000);
    }

    const uniqueJobs = [...new Map(jobs.map(j => [j.url, j])).values()];
    return uniqueJobs;
}

module.exports = { scrapeFacebook };
