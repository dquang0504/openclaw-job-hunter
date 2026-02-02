/**
 * TopCV.vn Scraper
 */

const path = require('path');
const CONFIG = require('../config');
const { calculateMatchScore } = require('../lib/filters');

/**
 * Scrape jobs from TopCV.vn
 * @param {import('playwright').Page} page 
 * @param {import('../lib/telegram')} reporter 
 */
async function scrapeTopCV(page, reporter) {
    console.log('📋 Searching TopCV.vn...');

    const jobs = [];

    console.log(`  🔍 Searching with ${CONFIG.keywords.length} keywords...`);

    const experienceLevels = [1, 2, 3]; // 1: No Exp, 2: <1 Year, 3: 1 Year

    for (const keyword of CONFIG.keywords) {
        for (const exp of experienceLevels) {
            try {
                // Slugify keyword: "golang" -> "golang"
                const slug = keyword.toLowerCase().split(/\s+/).join('-');

                // Specific URL for Can Tho location (kl20 / l20)
                const searchUrl = `https://www.topcv.vn/tim-viec-lam-${slug}-tai-can-tho-kl20?exp=${exp}&sort=new&type_keyword=1&sba=1&locations=l20&saturday_status=0`;
                console.log(`  🔍 Searching: ${keyword} (Exp: ${exp}) - Cần Thơ`);

                // Reduced timeout and no random delay
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });

                // Check for CAPTCHA
                if (await page.locator('.captcha, .recaptcha, [data-captcha]').count() > 0) {
                    console.log('⚠️ CAPTCHA detected...');
                    continue;
                }

                // Fast scroll to trigger lazy load
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await page.waitForTimeout(500);

                // Check if "No suitable job" message is visible (User confirmed logic)
                // If visible, it means the search returned 0 exact matches, and any cards below are "Suggested" jobs.
                if (await page.locator('.none-suitable-job').isVisible()) {
                    console.log(`    ⚠️ No suitable jobs found (strict match)`);
                    continue;
                }

                // Strict selector: Only pick up direct search results, NOT suggested jobs
                const jobCards = await page.locator('.job-item-search-result').all();
                console.log(`    📦 Found ${jobCards.length} job cards`);

                // Process only top 10 for speed
                for (const card of jobCards.slice(0, 10)) {
                    try {
                        const titleEl = card.locator('h3.title a, .title-block a, a.title').first();
                        const title = await titleEl.textContent().catch(() => null);
                        const urlVal = await titleEl.getAttribute('href').catch(() => null);

                        const company = await card.locator('.company-name a, .company a, .employer-name').first().textContent().catch(() => 'Unknown');
                        const location = await card.locator('.address, .location, .label-address').first().textContent().catch(() => 'Vietnam');

                        if (!title) continue;

                        const job = {
                            title: title.trim(),
                            company: company.trim(),
                            url: urlVal?.startsWith('http') ? urlVal : `https://www.topcv.vn${urlVal}`,
                            salary: 'Negotiable',
                            location: location?.trim(),
                            source: 'TopCV.vn',
                            techStack: 'Golang'
                        };

                        const jobText = `${job.title} ${job.company}`.toLowerCase();
                        const locLower = job.location.toLowerCase();

                        // 1. Strict Keyword Check
                        if (!jobText.includes('go') && !jobText.includes('golang')) continue;

                        // 2. Strict Exclude (Experience)
                        if (CONFIG.excludeRegex.test(jobText)) continue;

                        // 3. Strict Location (Remote or Can Tho)
                        const isTarget = locLower.includes('remote') || locLower.includes('từ xa') || locLower.includes('cần thơ') || locLower.includes('can tho');
                        const isHanoiHCM = locLower.includes('hà nội') || locLower.includes('hồ chí minh') || locLower.includes('hcm') || locLower.includes('ho chi minh');

                        if (!isTarget && isHanoiHCM) continue;

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
