/**
 * TopCV.vn Scraper
 */

const path = require('path');
const CONFIG = require('../config');
const { randomDelay, humanScroll } = require('../lib/stealth');
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

    for (const keyword of CONFIG.keywords) {
        try {
            const searchUrl = `https://www.topcv.vn/tim-viec-lam-it?keyword=${encodeURIComponent(keyword)}`;
            console.log(`  🔍 Searching: ${keyword}`);

            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await randomDelay(500, 1000);

            // Check for CAPTCHA
            if (await page.locator('.captcha, .recaptcha, [data-captcha]').count() > 0) {
                const screenshotPath = path.join(CONFIG.paths.screenshots, `captcha-topcv-${Date.now()}.png`);
                await page.screenshot({ path: screenshotPath, fullPage: true });
                await reporter.sendCaptchaAlert(screenshotPath);
                console.log('⚠️ CAPTCHA detected, waiting for manual resolution...');
                continue;
            }

            // Wait for job cards to load
            await page.waitForSelector('.job-item-search-result, .job-list-2', { timeout: 10000 }).catch(() => { });

            await humanScroll(page);

            // Extract job listings
            const jobCards = await page.locator('.job-item-search-result, .box-job-item').all();
            console.log(`  📦 Found ${jobCards.length} job cards`);

            for (const card of jobCards.slice(0, 5)) {
                try {
                    const titleEl = card.locator('h3.title a, .title-block a, a.title').first();
                    const title = await titleEl.textContent().catch(() => null);
                    const url = await titleEl.getAttribute('href').catch(() => null);

                    const company = await card.locator('.company-name a, .company a, .employer-name').first().textContent().catch(() => 'Unknown');
                    const salary = await card.locator('.salary, .label-salary, .box-job-item__salary').first().textContent().catch(() => null);
                    const location = await card.locator('.address, .location, .label-address').first().textContent().catch(() => null);

                    if (!title) continue;

                    const job = {
                        title: title.trim(),
                        company: company.trim(),
                        url: url?.startsWith('http') ? url : `https://www.topcv.vn${url}`,
                        salary: salary?.trim(),
                        location: location?.trim(),
                        source: 'TopCV.vn',
                        techStack: 'Go, Backend'
                    };

                    // Include if contains golang/go keywords
                    const jobText = `${job.title} ${job.company}`.toLowerCase();
                    if (jobText.includes('go') || jobText.includes('golang') || jobText.includes('backend')) {
                        if (!CONFIG.excludeRegex.test(jobText)) {
                            job.matchScore = calculateMatchScore(job);
                            jobs.push(job);
                            console.log(`    ✅ ${job.title}`);
                        }
                    }
                } catch (e) {
                    // Skip malformed cards
                }
            }

            await randomDelay(1000, 2000);
        } catch (error) {
            console.error(`Error searching "${keyword}":`, error.message);
        }
    }

    // Remove duplicates by URL
    const uniqueJobs = [...new Map(jobs.map(j => [j.url, j])).values()];
    return uniqueJobs;
}

module.exports = { scrapeTopCV };
