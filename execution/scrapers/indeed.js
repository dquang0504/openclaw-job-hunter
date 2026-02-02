/**
 * Indeed Scraper (Vietnam)
 */

const CONFIG = require('../config');
const { randomDelay, humanScroll } = require('../lib/stealth');
const { calculateMatchScore } = require('../lib/filters');

async function scrapeIndeed(page, reporter) {
    console.log('💼 Searching Indeed.com...');
    const jobs = [];
    const keyword = 'Golang';
    // Search general Vietnam to catch all, then filter strictly.
    const searchUrl = `https://vn.indeed.com/jobs?q=${encodeURIComponent(keyword)}&l=Vietnam&sort=date`;

    try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await randomDelay(1000, 2000);

        // Check for Cloudflare challenge
        const title = await page.title();
        if (title.includes('Just a moment') || title.includes('Challenge')) {
            console.log('  ⚠️ Indeed Cloudflare detected. Waiting...');
            await page.waitForTimeout(5000);
        }

        await humanScroll(page);

        // Selectors
        const cardSelector = '.job_seen_beacon, .resultContent';
        const jobCards = await page.locator(cardSelector).all();
        console.log(`  📦 Found ${jobCards.length} job cards on Indeed`);

        for (const card of jobCards) {
            try {
                const titleEl = card.locator('h2.jobTitle span[title], a[id^="job_"]').first();
                const title = await titleEl.textContent().catch(() => '');

                const companyEl = card.locator('[data-testid="company-name"], .companyName');
                const company = await companyEl.textContent().catch(() => 'Unknown');

                const locationEl = card.locator('[data-testid="text-location"], .companyLocation');
                const location = await locationEl.textContent().catch(() => 'Vietnam');

                // Get URL
                const linkEl = card.locator('h2.jobTitle a, a[id^="job_"]').first();
                let url = await linkEl.getAttribute('href').catch(() => null);
                if (url && !url.startsWith('http')) {
                    url = `https://vn.indeed.com${url}`;
                }

                if (!title || !url) continue;

                // Create job object
                const job = {
                    title: title.trim(),
                    company: company.trim(),
                    url: url,
                    salary: 'Negotiable',
                    location: location.trim(),
                    source: 'Indeed',
                    techStack: 'Golang'
                };

                // Filter
                const jobText = `${job.title} ${job.company}`.toLowerCase();
                const locLower = job.location.toLowerCase();

                // 1. Keyword check (Golang)
                if (!CONFIG.keywordRegex.test(jobText) || CONFIG.excludeRegex.test(jobText)) continue;

                // 2. Strict Location check
                // User requirement: ONLY Remote or Can Tho
                const isTarget = locLower.includes('remote') || locLower.includes('từ xa') || locLower.includes('cần thơ') || locLower.includes('can tho');
                const isHanoiHCM = locLower.includes('hà nội') || locLower.includes('hồ chí minh') || locLower.includes('hcm') || locLower.includes('ho chi minh');

                if (!isTarget && isHanoiHCM) continue; // Skip if explicitly big city and NOT remote
                // If location is "Vietnam" (generic), we might keep it but label it "Verify Location"

                if (CONFIG.keywordRegex.test(jobText) && !CONFIG.excludeRegex.test(jobText)) {
                    job.matchScore = calculateMatchScore(job);
                    jobs.push(job);
                    console.log(`    ✅ ${job.title}`);
                }

            } catch (e) {
                // Ignore
            }
        }

    } catch (error) {
        console.error(`  ❌ Indeed Error: ${error.message}`);
    }

    return jobs;
}

module.exports = { scrapeIndeed };
