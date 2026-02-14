/**
 * TopDev.vn Scraper
 * Enhanced with anti-bot detection measures
 */

const CONFIG = require('../config');
const { calculateMatchScore } = require('../lib/filters');
const { randomDelay, mouseJiggle, smoothScroll } = require('../lib/stealth');
const ScreenshotDebugger = require('../lib/screenshot');

/**
 * Scrape jobs from TopDev.vn
 * @param {import('playwright').Page} page 
 * @param {import('../lib/telegram')} reporter 
 */
async function scrapeTopDev(page, reporter) {
    console.log('📋 Searching TopDev.vn...');

    const jobs = [];
    const screenshotDebugger = new ScreenshotDebugger(reporter);
    const keywords = CONFIG.keywords || ['golang'];

    // TopDev Levels: 1616 (Intern), 1617 (Fresher)
    // We will scrape BOTH levels sequentially.
    const levels = [
        { id: '1616', name: 'Intern' },
        { id: '1617', name: 'Fresher' }
    ];

    for (const keyword of keywords) {
        for (const level of levels) {
            try {
                // Updated URL construction based on user input
                const searchUrl = `https://topdev.vn/jobs/search?keyword=${encodeURIComponent(keyword)}&page=1&region_ids=79%2C92&job_levels_ids=${level.id}`;
                console.log(`  🔍 Searching: ${keyword} (${level.name}) - HCM/Can Tho`);

                // STEALTH MODE: Navigate with realistic behavior (2 minute timeout)
                try {
                    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
                } catch (e) {
                    if (e.message.includes('Timeout')) {
                        console.log(`    ⚠️ domcontentloaded timeout, trying networkidle...`);
                        await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 120000 });
                    } else {
                        throw e;
                    }
                }

                // DEBUG: Log current page info
                const pageTitle = await page.title();
                const currentUrl = page.url();
                console.log(`    🔍 DEBUG: Page title: ${pageTitle}`);
                console.log(`    🔍 DEBUG: Current URL: ${currentUrl}`);

                // ANTI-BOT: Check for Cloudflare challenge
                if (pageTitle.includes('Just a moment') || pageTitle.includes('Checking your browser')) {
                    console.log('    🛡️ Cloudflare challenge detected. Waiting...');
                    await screenshotDebugger.captureCloudflare(page, 'TopDev');
                    await page.waitForTimeout(8000);

                    const stillChallenged = await page.title().then(t => t.includes('Just a moment'));
                    if (stillChallenged) {
                        console.log('    ⚠️ Cloudflare challenge still active. Waiting longer...');
                        await page.waitForTimeout(7000);
                    }
                }

                // CHECK: Promo popup redirect (hiring-reward-thang-1-2026)
                if (currentUrl.includes('hiring-reward') || currentUrl.includes('promo')) {
                    console.log('    🎁 Promo popup detected! Attempting to close...');
                    await screenshotDebugger.captureAndSend(page, 'topdev-promo-popup', '🎁 TopDev: Promo popup detected');

                    // Try to close popup or go back
                    const closeButton = page.locator('button:has-text("Close"), button:has-text("×"), [aria-label="Close"]').first();
                    if (await closeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                        await closeButton.click();
                        console.log('    ✅ Closed promo popup');
                        await page.waitForTimeout(1000);
                    } else {
                        console.log('    ⚠️ No close button found, going back...');
                        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });
                        await page.waitForTimeout(2000);
                    }
                }

                // HUMAN BEHAVIOR: Random mouse movement and scroll
                await randomDelay(800, 1500);
                await mouseJiggle(page);
                await smoothScroll(page, 200);
                await randomDelay(500, 1000);

                // 1. Check for "Jobs you may be interested in" (Indicates no exact matches)
                const selector = 'span.font-semibold.text-brand-500';
                const hasSuggestion = await page
                    .waitForSelector(`${selector}:has-text("Jobs you may be interested in")`, { timeout: 3000 })
                    .then(() => true)
                    .catch(() => false);

                if (hasSuggestion) continue;

                // Wait for content to load with human-like delay
                await randomDelay(1500, 2500);

                // Select all job cards using specific User Provided Selector
                // KEY DIFFERENCE: List items have 'cursor-pointer', Detail header usually does not.
                // We strictly require 'cursor-pointer' to avoid selecting the detail header duplicate.
                const jobCards = await page.locator('div.text-card-foreground.shadow.cursor-pointer.bg-white, div.cursor-pointer[class*="text-card-foreground"][class*="rounded-[16px]"]').all();

                if (jobCards.length === 0) {
                    // Check for result indicators
                    const resultCount = await page.locator('span.font-semibold.text-brand-500').first().textContent().catch(() => '');
                    if (resultCount.includes('results')) {
                        console.log(`    ⚠️ Detected results (${resultCount}) but selector failed to match 'div.cursor-pointer'.`);
                    } else {
                        console.log(`    ⚠️ No job cards found for "${keyword}" (${level.name})`);
                    }
                    continue;
                } else {
                    console.log(`    📦 Found ${jobCards.length} job cards`);
                }

                for (const item of jobCards.slice(0, 15)) {
                    try {
                        let card = item;

                        // Extract Title & Company from Card
                        // Title: <a href="/detail-jobs/...">AI Engineer...</a>
                        const titleEl = card.locator('a[href*="/detail-jobs/"]').first();
                        const title = await titleEl.textContent().catch(() => 'Unknown Title');
                        const link = await titleEl.getAttribute('href').catch(() => '');

                        // Company: <span class="line-clamp-1 ... text-text-500">COMPANY NAME</span>
                        // Or <a href="/companies/...">
                        const company = await card.locator('span.text-text-500.line-clamp-1, a[href*="/companies/"]').first().textContent().catch(() => 'Unknown Company');

                        // Salary: <span class="text-brand-500 ...">...</span>
                        const salary = await card.locator('span.text-brand-500').first().textContent().catch(() => 'Negotiable');

                        // Location: <span class="line-clamp-1">Thành phố Hồ Chí Minh</span>
                        // It's usually one of the spans with line-clamp-1 not being the company or salary
                        // Let's grab all line-clamp-1 and pick
                        const location = await card.locator('span.line-clamp-1').allTextContents().then(texts => texts.find(t => t.includes('Hồ Chí Minh') || t.includes('Cần Thơ')) || 'Unknown');

                        // URL Construction
                        const url = link.startsWith('http') ? link : `https://topdev.vn${link}`;

                        // HUMAN BEHAVIOR: Scroll into view naturally
                        await card.scrollIntoViewIfNeeded();
                        await randomDelay(300, 600);

                        // Click with human-like delay
                        await card.click({ force: true });
                        await randomDelay(800, 1200);

                        // Wait for Detail Panel
                        const detailContainer = page.locator('div.h-\\[54vh\\].overflow-auto, div.xl\\:h-\\[66vh\\]').first();
                        await detailContainer.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);

                        // Extract Description
                        const description = await detailContainer.textContent().catch(() => '');

                        // Cleanup & Object Creation
                        const job = {
                            title: title.trim(),
                            company: company.replace('Logo', '').trim(),
                            url: url,
                            salary: salary?.trim(),
                            location: location?.trim(),
                            source: 'TopDev',
                            description: description?.trim().slice(0, 5000),
                            techStack: 'Golang' // Placeholder
                        };

                        job.matchScore = calculateMatchScore(job);

                        // Exclude Regex Check
                        if (CONFIG.excludeRegex.test(job.title)) continue;

                        // Strict "3 years" check in description if extracted
                        if (description && /\b([3-9]|\d{2,})\s*(\+|plus)?\s*(năm|nam|years?|yoe)\b/i.test(description)) {
                            // console.log(`      ⚠️ Skipped (High YoE in desc): ${title}`);
                            continue;
                        }

                        // Dynamic Keyword Check
                        // Check if Title OR Description contains the searched keyword.
                        const kLower = keyword.toLowerCase();
                        if (!job.title.toLowerCase().includes(kLower) && !job.description.toLowerCase().includes(kLower)) {
                            // Relaxed check: if we found it via search, it's likely relevant unless totally off
                            // console.log(`      ⏭️ Skipped (Keyword mismatch "${keyword}"): ${title}`);
                            continue;
                        }

                        jobs.push(job);
                        console.log(`      ✅ ${job.title} - ${job.company}`);

                    } catch (e) {
                        // console.warn('      Failed to process a card:', e.message);
                    }
                }

            } catch (error) {
                console.error(`  ⚠️ TopDev Error for ${keyword}: ${error.message}`);
            }
        }
    }

    return jobs;
}


module.exports = { scrapeTopDev };
