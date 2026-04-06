/**
 * Indeed Scraper (Vietnam)
 * Strategy: Combinatorial Search (Keywords x Locations) + Fast Filtering
 */

const CONFIG = require('../config');
const { randomDelay, humanScroll } = require('../lib/stealth');
const { analyzeLocation, calculateMatchScore, shouldRejectForLevel } = require('../lib/filters');

/**
 * Helper: Normalize text to handle fancy fonts and accents
 */
const normalizeText = (text) => (text || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

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
                    console.log('  ⚠️ Cloudflare detected. Waiting 3s...');
                    await page.waitForTimeout(3000);
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
                        const locationRaw = await locationEl.textContent().catch(() => 'Vietnam');
                        const locationNorm = normalizeText(locationRaw);

                        // --- FAST FILTER ---
                        const locLower = locationNorm; // already lowercase

                        const fastLocation = analyzeLocation(locLower);
                        if (fastLocation.isHanoiOnly) {
                            // Reject immediately
                            // console.log(`    ❌ Skipped (Fast Loc): ${locationRaw}`);
                            continue;
                        }

                        // Check Exclude Title
                        if (shouldRejectForLevel(normalizeText(title))) {
                            console.log(`    ❌ Skipped (Fast Title): ${title}`);
                            continue;
                        }

                        // --- DEEP CHECK (Selective) ---
                        // Only verify if we passed the fast filter
                        console.log(`    🔍 Verify: ${title.slice(0, 30)}...`);

                        let description = '';

                        try {
                            await card.scrollIntoViewIfNeeded({ timeout: 3000 });
                            await linkEl.click({ timeout: 2000 }).catch(() => card.click({ timeout: 2000, force: true }));

                            const descSelector = '#jobDescriptionText, .jobsearch-JobComponent-description';
                            await page.waitForSelector(descSelector, { timeout: 4000 });
                            description = await page.innerText(descSelector).catch(() => '');
                        } catch (e) {
                            console.log(`      ⚠️ Desc load failed/timeout for ${title}`);
                        }

                        // CRITICAL: Reject if description is empty or too short
                        if (!description || description.length < 50) {
                            console.log(`      ⚠️ Skipped (Empty/Failed Description)`);
                            continue;
                        }

                        // Normalize full text including description
                        const jobTextNorm = normalizeText(`${title} ${company} ${locationRaw} ${description}`);

                        // Re-check Keyword in Description
                        if (!CONFIG.keywordRegex.test(jobTextNorm)) {
                            console.log(`      ❌ Skipped (No Keyword in Desc)`);
                            continue;
                        }

                        // Re-check Location in Description
                        const deepLocation = analyzeLocation(jobTextNorm);
                        if (deepLocation.isHanoiOnly) {
                            console.log(`      ❌ Skipped (Verify Loc Failed)`);
                            continue;
                        }

                        // VALID
                        const job = {
                            title: title.trim(),
                            company: company.trim(),
                            url: url,
                            salary: 'Negotiable',
                            location: locationRaw.trim(),
                            source: 'Indeed',
                            techStack: 'Golang',
                            description: description.slice(0, 200) + '...'
                        };

                        job.matchScore = calculateMatchScore(job);

                        // Add to map
                        jobsMap.set(uniqueKey, job);
                        seenKeys.add(uniqueKey);
                        console.log(`      ✅ MATCHED: ${job.title}`);

                        // Reduced delay for faster processing
                        await randomDelay(300, 600);

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
