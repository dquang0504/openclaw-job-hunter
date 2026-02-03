/**
 * Indeed Scraper (Vietnam)
 * Strategy: Combinatorial Search (Keywords x Locations) + Fast Filtering
 */

const CONFIG = require('../config');
const { randomDelay, humanScroll } = require('../lib/stealth');
const { calculateMatchScore } = require('../lib/filters');

async function scrapeIndeed(page, reporter) {
    console.log('💼 Searching Indeed.com...');

    // Store unique jobs. Key = "Title|Company"
    // We use a Map to keep track of the BEST version (e.g. valid URL) if duplicates occur
    const jobsMap = new Map();
    const seenKeys = new Set();

    // Combinations requested by User
    const searchKeywords = CONFIG.keywords; // ['golang']
    const searchLocations = ['Vietnam', 'Cần Thơ', 'Remote'];

    for (const keyword of searchKeywords) {
        for (const locParam of searchLocations) {

            console.log(`\n🔄 Loop: Keyword="${keyword}" | Location="${locParam}"`);
            const searchUrl = `https://vn.indeed.com/jobs?q=${encodeURIComponent(keyword)}&l=${encodeURIComponent(locParam)}&sort=date`;

            try {
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await randomDelay(1000, 2000);

                // Cloudflare Check
                const pageTitle = await page.title();
                if (pageTitle.includes('Just a moment') || pageTitle.includes('Challenge')) {
                    console.log('  ⚠️ Cloudflare detected. Waiting 5s...');
                    await page.waitForTimeout(5000);
                }

                await humanScroll(page);

                // Selectors
                const cardSelector = '.job_seen_beacon, .resultContent';
                const jobCards = await page.locator(cardSelector).all();

                if (jobCards.length === 0) {
                    console.log(`  ℹ️ No jobs found for ${keyword} in ${locParam}`);
                    continue;
                }

                console.log(`  📦 Found ${jobCards.length} cards`);

                for (const card of jobCards) {
                    try {
                        // Basic Info
                        const titleEl = card.locator('h2.jobTitle span[title], a[id^="job_"]').first();
                        const title = await titleEl.textContent().catch(() => '');

                        const companyEl = card.locator('[data-testid="company-name"], .companyName');
                        const company = await companyEl.textContent().catch(() => 'Unknown');

                        // Deduplication Key (Title + Company)
                        const uniqueKey = `${title}|${company}`.toLowerCase();

                        // Get URL
                        const linkEl = card.locator('h2.jobTitle a, a[id^="job_"]').first();
                        let url = await linkEl.getAttribute('href').catch(() => null);
                        if (url && !url.startsWith('http')) url = `https://vn.indeed.com${url}`;

                        if (!title || !url) continue;

                        // Check if we already have this job
                        if (seenKeys.has(uniqueKey)) {
                            // console.log(`    ℹ️ Duplicate skipped: ${title}`);
                            continue;
                        }

                        const locationEl = card.locator('[data-testid="text-location"], .companyLocation');
                        const location = await locationEl.textContent().catch(() => 'Vietnam');

                        // --- FAST FILTER ---
                        const locLower = location.toLowerCase();

                        // Valid Targets
                        const isRemote = locLower.includes('remote') || locLower.includes('từ xa') ||
                            locLower.includes('cần thơ') || locLower.includes('can tho');

                        // Invalid Targets (Hard Block)
                        const isHanoiHCM = locLower.includes('hà nội') || locLower.includes('hồ chí minh') || locLower.includes('hcm') || locLower.includes('ho chi minh');

                        if (!isRemote && isHanoiHCM) {
                            // Reject immediately
                            // console.log(`    ❌ Skipped (Fast Loc): ${location}`);
                            continue;
                        }

                        // Check Exclude Title
                        if (CONFIG.excludeRegex.test(title.toLowerCase())) {
                            console.log(`    ❌ Skipped (Fast Title): ${title}`);
                            continue;
                        }

                        // --- DEEP CHECK (Selective) ---
                        // Only verify if we passed the fast filter
                        console.log(`    🔍 Verify: ${title.slice(0, 30)}...`);

                        let description = '';

                        try {
                            await card.scrollIntoViewIfNeeded({ timeout: 5000 });
                            await linkEl.click({ timeout: 3000 }).catch(() => card.click({ timeout: 3000, force: true }));

                            const descSelector = '#jobDescriptionText, .jobsearch-JobComponent-description';
                            await page.waitForSelector(descSelector, { timeout: 5000 });
                            description = await page.innerText(descSelector).catch(() => '');
                        } catch (e) {
                            console.log(`      ⚠️ Desc load failed/timeout for ${title}`);
                        }

                        // CRITICAL: Reject if description is empty or too short
                        if (!description || description.length < 50) {
                            console.log(`      ⚠️ Skipped (Empty/Failed Description)`);
                            continue;
                        }

                        const jobText = `${title} ${company} ${location} ${description}`.toLowerCase();

                        // Re-check Keyword in Description
                        if (!CONFIG.keywordRegex.test(jobText)) {
                            console.log(`      ❌ Skipped (No Keyword in Desc)`);
                            continue;
                        }

                        // Re-check Location in Description
                        const descRemote = description.includes('remote') || description.includes('làm việc từ xa') || description.includes('cần thơ');
                        if (!isRemote && isHanoiHCM && !descRemote) {
                            console.log(`      ❌ Skipped (Verify Loc Failed)`);
                            continue;
                        }

                        // VALID
                        const job = {
                            title: title.trim(),
                            company: company.trim(),
                            url: url,
                            salary: 'Negotiable',
                            location: location.trim(),
                            source: 'Indeed',
                            techStack: 'Golang',
                            description: description.slice(0, 200) + '...'
                        };

                        job.matchScore = calculateMatchScore(job);

                        // Add to map
                        jobsMap.set(uniqueKey, job);
                        seenKeys.add(uniqueKey);
                        console.log(`      ✅ MATCHED: ${job.title}`);

                        await randomDelay(500, 1000);

                    } catch (e) {
                        console.log(`    ⚠️ Error processing card: ${e.message}`);
                    }
                } // end card loop

            } catch (pageError) {
                console.error(`  ⚠️ Error scraping ${searchUrl}:`, pageError.message);
            }
        } // end location loop
    } // end keyword loop

    return Array.from(jobsMap.values());
}

module.exports = { scrapeIndeed };
