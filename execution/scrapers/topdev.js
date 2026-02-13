/**
 * TopDev.vn Scraper
 */

const CONFIG = require('../config');
const { calculateMatchScore } = require('../lib/filters');

/**
 * Scrape jobs from TopDev.vn
 * @param {import('playwright').Page} page 
 * @param {import('../lib/telegram')} reporter 
 */
async function scrapeTopDev(page, reporter) {
    console.log('📋 Searching TopDev.vn...');

    const jobs = [];
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

                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

                // 1. Check for "Jobs you may be interested in" (Indicates no exact matches)
                // HTML: <span class="font-semibold text-brand-500">Jobs you may be interested in</span>
                const selector = 'span.font-semibold.text-brand-500';
                const hasSuggestion = await page
                    .waitForSelector(`${selector}:has-text("Jobs you may be interested in")`, { timeout: 3000 })
                    .then(() => true)
                    .catch(() => false);

                if (hasSuggestion) continue;

                // Wait for list to populate
                await page.waitForTimeout(3000);

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

                        // Click to Load Details
                        await card.scrollIntoViewIfNeeded();
                        await card.click({ force: true });

                        // Wait for Detail Panel
                        // User HTML: <div class="h-[54vh] overflow-auto xl:h-[66vh]">
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
