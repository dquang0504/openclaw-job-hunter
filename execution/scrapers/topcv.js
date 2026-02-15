/**
 * TopCV.vn Scraper
 */

const path = require('path');
const CONFIG = require('../config');
const { calculateMatchScore } = require('../lib/filters');
const ScreenshotDebugger = require('../lib/screenshot');
const { randomDelay, mouseJiggle, smoothScroll, humanScroll, applyStealthSettings } = require('../lib/stealth');

/**
 * Helper: Normalize text to handle fancy fonts and accents
 */
const normalizeText = (text) => (text || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Scrape jobs from TopCV.vn
 * @param {import('playwright').Page} page 
 * @param {import('../lib/telegram')} reporter 
 */
async function scrapeTopCV(page, reporter) {
    console.log('📋 Searching TopCV.vn...');

    const jobs = [];
    const screenshotDebugger = new ScreenshotDebugger(reporter);
    let isBlocked = false;

    // STEALTH: Apply browser spoofing
    await applyStealthSettings(page);

    // ANTI-BOT: Warm-up Phase
    try {
        console.log('🏠 Navigating to TopCV Home for warm-up...');
        await page.goto('https://www.topcv.vn/', { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Random check for blocked status immediately on home
        const title = await page.title();
        if (title.includes('Cloudflare') || title.includes('Attention Required')) {
            throw new Error('Cloudflare blocked on Homepage');
        }

        const warmUpDuration = 5000 + Math.random() * 5000;
        console.log(`⏳ Warming up for ${(warmUpDuration / 1000).toFixed(1)}s...`);
        const startTime = Date.now();
        while (Date.now() - startTime < warmUpDuration) {
            // Random scroll/mouse moves
            if (Math.random() > 0.5) {
                await mouseJiggle(page);
            } else {
                await page.mouse.wheel(0, 300);
                await randomDelay(500, 1000);
                await page.mouse.wheel(0, -200);
            }
            await randomDelay(1000, 2000);
        }
        console.log('✅ Warm-up complete.');
    } catch (e) {
        console.log('⚠️ Warm-up warning:', e.message);
        if (e.message.includes('Cloudflare')) {
            console.warn('    🛡️ Cloudflare challenge detected on Home! 🚫 Skipping...');
            await screenshotDebugger.captureAndSend(page, 'topcv-cloudflare-home', '🚨 TopCV: Blocked by Cloudflare on Homepage');
            return [];
        }
    }

    console.log(`  🔍 Searching with ${CONFIG.keywords.length} keywords...`);

    const experienceLevels = [1, 2, 3]; // 1: No Exp, 2: <1 Year, 3: 1 Year

    for (const keyword of CONFIG.keywords) {
        if (isBlocked) break;
        for (const exp of experienceLevels) {
            if (isBlocked) break;
            try {
                // Slugify keyword: "golang" -> "golang"
                const slug = keyword.toLowerCase().split(/\s+/).join('-');

                // Specific URL for Can Tho (l20) AND Ho Chi Minh (l2)
                const searchUrl = `https://www.topcv.vn/tim-viec-lam-${slug}-tai-ho-chi-minh-kl2?exp=${exp}&sort=new&type_keyword=1&sba=1&locations=l2_l20&saturday_status=0`;
                console.log(`  🔍 Searching: ${keyword} (Exp: ${exp}) - Cần Thơ & HCM`);

                // STEALTH: Add Referer and Navigate
                try {
                    await page.setExtraHTTPHeaders({
                        'Referer': 'https://www.topcv.vn/'
                    });

                    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                    // Clear headers for next request
                    await page.setExtraHTTPHeaders({});

                } catch (e) {
                    if (e.message.includes('Timeout')) {
                        console.log(`    ⚠️ domcontentloaded timeout, trying networkidle...`);
                        await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
                    } else {
                        throw e;
                    }
                }

                // ANTI-BOT: Check for Cloudflare challenge (same as TopDev)
                const pageTitle = await page.title();
                if (pageTitle.includes('Attention Required') || pageTitle.includes('Just a moment') || pageTitle.includes('Cloudflare')) {
                    console.warn('    🛡️ Cloudflare challenge detected! 🚫 Skipping entire TopCV scraper...');
                    await screenshotDebugger.captureAndSend(page, 'topcv-cloudflare-blocked', '🚨 TopCV: Blocked by Cloudflare - Scraper terminally skipped');
                    isBlocked = true;
                    break;
                }

                // Check for CAPTCHA
                if (await page.locator('.captcha, .recaptcha, [data-captcha]').count() > 0) {
                    console.log('⚠️ CAPTCHA detected...');
                    continue;
                }

                // HUMAN BEHAVIOR: Random mouse movement and scroll
                await randomDelay(800, 1500);
                await mouseJiggle(page);
                await smoothScroll(page, 200);
                await randomDelay(500, 1000);

                // Fast scroll to trigger lazy load (Human-like)
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
                await randomDelay(500, 1000);
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

                // Wait for content to stabilize
                await randomDelay(1000, 2000);

                // Check if "No suitable job" message is visible (User confirmed logic)
                if (await page.locator('.none-suitable-job').isVisible()) {
                    console.log(`    ⚠️ No suitable jobs found (strict match)`);
                    continue;
                }

                // DEBUG: Check page title and URL to verify we're on the right page
                const currentUrl = page.url();
                console.log(`    🔍 DEBUG: Page title: ${await page.title()}`);
                console.log(`    🔍 DEBUG: Current URL: ${currentUrl}`);

                // Strict selector: Only pick up direct search results, NOT suggested jobs
                const jobCards = await page.locator('.job-item-search-result').all();
                console.log(`    📦 Found ${jobCards.length} job cards`);

                // DEBUG: If no cards found, try alternative selectors
                if (jobCards.length === 0) {
                    const altCards1 = await page.locator('.job-item').all();
                    const altCards2 = await page.locator('[class*="job-item"]').all();
                    console.log(`    🔍 DEBUG: Alternative selector '.job-item': ${altCards1.length} cards`);
                    console.log(`    🔍 DEBUG: Alternative selector '[class*="job-item"]': ${altCards2.length} cards`);
                }

                // Process only top 20 for speed
                for (const card of jobCards.slice(0, 20)) {
                    try {
                        const titleEl = card.locator('h3.title a, .title-block a, a.title').first();

                        // HUMAN BEHAVIOR: Occasional small delay or move during processing (not every card to save time)
                        if (Math.random() > 0.8) {
                            await mouseJiggle(page);
                        }

                        // Fail fast (100ms) if element not found to avoid blocking
                        const title = await titleEl.textContent({ timeout: 100 }).catch(() => null);
                        const urlVal = await titleEl.getAttribute('href', { timeout: 100 }).catch(() => null);

                        // Improved Company Selector: target the span or link text directly
                        const company = await card.locator('.company-name, .company-name a, .company a, .employer-name').first().textContent({ timeout: 100 }).catch(() => 'Unknown');
                        const location = await card.locator('.address, .location, .label-address').first().textContent({ timeout: 100 }).catch(() => 'Vietnam');
                        const salary = await card.locator('.title-salary, .salary').first().textContent({ timeout: 100 }).catch(() => 'Negotiable');

                        if (!title) continue;

                        const job = {
                            title: title.trim(),
                            company: company.trim(),
                            url: urlVal?.startsWith('http') ? urlVal : `https://www.topcv.vn${urlVal}`,
                            salary: salary?.trim() || 'Negotiable',
                            location: location?.trim(),
                            source: 'TopCV.vn',
                            techStack: 'Golang'
                        };

                        // Use Normalized text for checks
                        const jobTextNorm = normalizeText(`${job.title} ${job.company}`);
                        // const locLower = normalizeText(job.location); // Not strict filtering location since we search for specific locs

                        // 1. Strict Keyword Check
                        if (!jobTextNorm.includes('go') && !jobTextNorm.includes('golang')) continue;

                        // 2. Strict Exclude (Experience)
                        if (CONFIG.excludeRegex.test(jobTextNorm)) continue;

                        // 3. Strict Location (Remote or Can Tho or HCM)
                        // Since we search via URL parameters (l2_l20), the results should be valid.
                        // We relax the strict block on "Hanoi/HCM" since HCM is now allowed.
                        /*
                        const isTarget = locLower.includes('remote') || locLower.includes('tu xa') || locLower.includes('can tho');
                        const isHanoiHCM = locLower.includes('ha noi') || locLower.includes('ho chi minh') || locLower.includes('hcm') || locLower.includes('saigon');
                        if (!isTarget && isHanoiHCM) continue; 
                        */

                        job.matchScore = calculateMatchScore(job);
                        jobs.push(job);
                        console.log(`      ✅ ${job.title} - ${job.location}`);

                    } catch (e) {
                        // Skip malformed
                    }
                }
            } catch (error) {
                console.error(`Error searching "${keyword}":`, error.message);
            }
        }
    }

    // Remove duplicates by URL
    const uniqueJobs = [...new Map(jobs.map(j => [j.url, j])).values()];
    return uniqueJobs;
}

module.exports = { scrapeTopCV };
