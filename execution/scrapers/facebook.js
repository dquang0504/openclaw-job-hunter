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

            // Reset Headers
            await page.setExtraHTTPHeaders({});

            // 3. Confirm Humanity
            await mouseJiggle(page);
            await randomDelay(3000, 5000);

            // Check for login/no-results
            if (await page.locator('input[name="email"]').count() > 0) {
                console.log('  🔒 Login wall detected. Cookies might be invalid.');
                continue;
            }
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
            let postSelector = 'div[role="feed"] > div, div[role="article"]';
            try {
                await page.waitForSelector('div[role="feed"], div[role="article"]', { timeout: 10000 });
            } catch (e) {
                console.log('  ⚠️ Post selector not found (might be no results or layout change)');
            }

            const posts = await page.locator(postSelector).all();
            console.log(`  📄 Found ${posts.length} visible posts`);

            const maxValidPosts = 3;
            const maxAttempts = Math.min(15, posts.length);
            let validPostsCount = 0;

            for (let i = 0; i < maxAttempts && validPostsCount < maxValidPosts; i++) {
                const post = posts[i];
                try {
                    // Extract Text and HTML for profile detection
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
                    // 1. Mandatory Keywords: Must have 'golang' AND ('backend' OR 'developer' OR 'kỹ sư')
                    // User requested "regex backend", so we ensure backend context.
                    if (!textNorm.includes('golang')) continue;

                    // 2. Exclude Senior/Lead/High Experience (User Request)
                    // Logic: Keep if Fresher/Junior.
                    // If Neutral (no level keywords), KEEP it UNLESS it explicitly says Senior/Lead or High YoE.
                    const isFresherOrJunior = CONFIG.includeRegex.test(textNorm) || textNorm.includes('fresher') || textNorm.includes('junior') || textNorm.includes('intern') || textNorm.includes('thực tập');
                    const isSeniorOrLead = textNorm.includes('senior') || textNorm.includes('lead') || textNorm.includes('manager') || textNorm.includes('trưởng nhóm');

                    // Years of experience check
                    // Exclude if it mentions 3+ years, 4 years, etc. (Strict: max 2 years allowed for non-senior)
                    // Matches: "3+", "3 năm", "3 years", "3yoe", "3 yoe"
                    // We allow "1-2 years" or "0-2 years", but "1-3 years" will match "3 years" and be excluded (as is desired by user)
                    const yoeMatch = textRaw.match(/([3-9]|\d{2,})\s*(\+|plus|\s*năm|\s*years?|\s*yoe)/i);

                    if (!isFresherOrJunior) {
                        // If NOT explicitly Fresher/Junior, we filter out Senior/HighYoE
                        if (isSeniorOrLead) {
                            console.log(`    ⏭️ Skipping Senior/Lead post: ${textRaw.slice(0, 30)}...`);
                            continue;
                        }
                        if (yoeMatch) {
                            console.log(`    ⏭️ Skipping High YoE post (${yoeMatch[0]}): ${textRaw.slice(0, 30)}...`);
                            continue;
                        }
                        // If neither Senior nor High YoE, it is "Neutral" -> KEEP
                    }

                    // 3. User requested "regex backend" - let's ensure we are targeting relevant roles
                    const jobKeywords = /backend|back-end|developer|engineer|lập trình|coder|dev/i;
                    if (!jobKeywords.test(textNorm)) continue;

                    const isFresherPost = isFresherOrJunior;
                    if (isFresherPost) console.log(`    🎯 FRESHER/JUNIOR post detected!`);

                    // Date Check (2 Months Logic)
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

                    // Extract Post URL (Permalink) - Strategy E: Single Click Heuristic
                    // The user wants HOVER + Single Click at -20px (Left 20px from SVG).
                    let postUrl = cleanGroupUrl;
                    let clickedSuccess = false;
                    let extractedTime = 'Recent'; // New: Capture timestamp text

                    try {
                        const svgs = await post.locator('span > span > svg').all();
                        let targetSvg = null;

                        for (const svg of svgs) {
                            const box = await svg.boundingBox();
                            if (!box) continue;

                            // Privacy/Globe icons are small (usually 12-16px).
                            if (box.width <= 20 && box.height <= 20) {
                                targetSvg = svg;
                                break;
                            }
                        }

                        if (targetSvg) {
                            // Ensure element is visible
                            try {
                                await targetSvg.scrollIntoViewIfNeeded().catch(() => { });
                                await page.waitForTimeout(500);
                            } catch (e) { }

                            // Re-fetch
                            const box = await targetSvg.boundingBox();

                            if (box) {
                                const centerY = box.y + (box.height / 2);
                                const startUrl = page.url();

                                // Strategy: Single Click at -20px (Left) as requested
                                const clickX = box.x - 20;

                                // Extract timestamp text
                                try {
                                    // Try getting text from parent levels (svg -> span -> span -> a)
                                    // We check ancestor elements for valid date-like text
                                    // This is heuristics based
                                    const parentText = await targetSvg.locator('xpath=./../../..').innerText({ timeout: 100 }).catch(() => '');
                                    const lines = parentText.split('\n');
                                    // Take first line that looks like a date (e.g. contains numbers or keywords)
                                    const potentialDate = lines.find(l => l.match(/\d|min|hr|day|hôm|qua/i));
                                    if (potentialDate && potentialDate.length < 30) {
                                        extractedTime = potentialDate.trim();
                                    }
                                } catch (e) { }

                                console.log(`      🖱️ Found SVG at (${Math.round(box.x)}, ${Math.round(box.y)}). Clicking Left 20px. Time: "${extractedTime}"`);

                                try {
                                    // HOVER first (400ms)
                                    await page.mouse.move(clickX, centerY);
                                    await page.waitForTimeout(400);

                                    // LEFT CLICK
                                    await page.mouse.click(clickX, centerY);
                                    await page.waitForTimeout(1000);

                                    const currentUrl = page.url();
                                    if (currentUrl !== startUrl && (currentUrl.includes('/posts/') || currentUrl.includes('/permalink/'))) {
                                        postUrl = currentUrl;
                                        clickedSuccess = true;
                                        console.log(`      🔗 SUCCESS! Link Clicked. URL: ${currentUrl}`);

                                        // Must go back to continue scraping
                                        await page.goBack();
                                        await page.waitForLoadState('domcontentloaded');
                                        await randomDelay(1000, 2000);
                                    } else {
                                        // console.log(`      ⚠️ Click didn't navigate to permalink. URL: ${currentUrl}`);
                                        if (currentUrl !== startUrl) await page.goBack();
                                    }
                                } catch (e) {
                                    console.log(`      ⚠️ Click Action Failed: ${e.message}`);
                                }
                            }
                        } else {
                            // SVG not found
                        }

                    } catch (e) {
                        console.log(`      ⚠️ Click Strategy Error: ${e.message}`);
                    }

                    // FALLBACK: Scan Links (Strategy D) if click failed
                    if (!clickedSuccess) {
                        const links = await post.locator('a[href]').all();
                        let foundPermalink = '';
                        // Prioritize /posts/ and avoid /user/
                        for (const link of links) {
                            const href = await link.getAttribute('href');
                            if (!href) continue;
                            if (href.includes('/posts/') && !href.includes('/user/')) {
                                foundPermalink = href;
                                break;
                            }
                            if (href.includes('/permalink/') && !foundPermalink) foundPermalink = href;
                        }

                        // Fallback to group link
                        if (foundPermalink) {
                            const baseUrl = 'https://www.facebook.com';
                            let fullUrl = foundPermalink.startsWith('http') ? foundPermalink : `${baseUrl}${foundPermalink}`;
                            fullUrl = fullUrl.replace(/([^:]\/)\/+/g, "$1").split('?')[0];
                            postUrl = fullUrl;
                        } else {
                            // Any group link > 50 chars
                            for (const link of links) {
                                const href = await link.getAttribute('href');
                                if (href && href.includes('/groups/') && href.length > 50 && !href.includes('/user/')) {
                                    postUrl = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
                                    break;
                                }
                            }
                        }
                    }

                    // Determine location for job object
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
                        postedDate: extractedTime, // Use captured time
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

        await randomDelay(3000, 6000);
    }

    const uniqueJobs = [...new Map(jobs.map(j => [j.url, j])).values()];
    return uniqueJobs;
}

module.exports = { scrapeFacebook };
