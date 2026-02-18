/**
 * LinkedIn Job Scraper - Authenticated Mode
 * Scrapes job listings directly from LinkedIn Jobs Search
 */

const CONFIG = require('../config');
const {
    randomDelay,
    humanScroll,
    mouseJiggle,
    applyStealthSettings
} = require('../lib/stealth');
const { calculateMatchScore } = require('../lib/filters');
const ScreenshotDebugger = require('../lib/screenshot');

/**
 * Helper: Normalize text to handle fancy fonts and accents
 */
const normalizeText = (text) => (text || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

async function scrapeLinkedIn(page, reporter) {
    console.log('💼 Searching LinkedIn Jobs (Authenticated)...');

    // Ensure stealth settings are active
    await applyStealthSettings(page);

    const screenshotDebugger = new ScreenshotDebugger(reporter);
    const jobs = [];
    const context = page.context();

    // --- WARM UP PHASE ---
    try {
        console.log('🏠 Navigating to LinkedIn Feed for warm-up...');
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Randomize warm-up duration (2-4s)
        const warmUpDuration = 2000 + Math.random() * 2000;
        const startTime = Date.now();
        console.log(`⏳ Warming up for ${(warmUpDuration / 1000).toFixed(1)}s with random behaviors...`);

        while (Date.now() - startTime < warmUpDuration) {
            await mouseJiggle(page);
            await page.waitForTimeout(1000 + Math.random() * 1000);
        }
    } catch (e) {
        console.log('⚠️ Warm-up failed (non-critical):', e.message);
    }
    // --- END WARM UP ---

    // Define Search URLs (User provided)
    // 1. History/Search origin
    const SEARCH_ORIGIN_URL = 'https://www.linkedin.com/search/results/all/?keywords=fresher%20golang&origin=HISTORY&position=0&sid=oz%3A';
    // 2. Job Search with filters (Fresher, Past Month, etc.)
    const JOB_SEARCH_URL = 'https://www.linkedin.com/jobs/search/?currentJobId=4324438500&f_E=1%2C2%2C3&f_TPR=r2592000&keywords=fresher%20golang&origin=JOB_SEARCH_PAGE_JOB_FILTER&spellCorrectionEnabled=true';

    try {
        // 1. Visit Search Origin
        console.log(`  🌐 Visiting Search Origin: ${SEARCH_ORIGIN_URL}`);
        await page.goto(SEARCH_ORIGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await randomDelay(2000, 3000);

        // 2. Visit Job Search URL
        console.log(`  🔍 Visiting Job Search: ${JOB_SEARCH_URL}`);
        await page.goto(JOB_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Wait for job list to load
        console.log('    ⏳ Waiting for job list...');
        try {
            await page.waitForSelector('.jobs-search-results-list', { timeout: 15000 });
        } catch (e) {
            console.log('    ⚠️ Main list selector not found, trying fallback...');
            await page.waitForSelector('ul.scaffold-layout__list-container', { timeout: 10000 });
        }

        await randomDelay(2000, 3000);
        await humanScroll(page, 3); // Scroll down a bit to load more items

        // Selectors provided by user
        // List Item: li.scaffold-layout__list-item
        // Card (Clickable): div.job-card-container
        const jobItemsSelector = 'li.scaffold-layout__list-item, li.jobs-search-results__list-item';

        const jobItems = await page.locator(jobItemsSelector).all();
        console.log(`    📄 Found ${jobItems.length} potential jobs in list.`);

        const maxJobs = Math.min(jobItems.length, 10); // Limit to 10 jobs

        for (let i = 0; i < maxJobs; i++) {
            try {
                const item = jobItems[i];

                // Click on the job card to load details
                const card = item.locator('.job-card-container').first();
                if (await card.isVisible()) {
                    console.log(`    👆 Clicking job ${i + 1}/${maxJobs}...`);

                    // Specific handling for clicking to ensuring it registers
                    await card.scrollIntoViewIfNeeded();
                    await card.click();

                    // Wait for detail view to load
                    // Selector: article.jobs-description__container > ... > div#job-details
                    await page.waitForTimeout(1000); // Initial wait

                    try {
                        await page.waitForSelector('#job-details', { timeout: 5000 });
                    } catch (e) {
                        console.log('      ⚠️ Detail view timeout.');
                    }

                    await randomDelay(1000, 2000); // Simulate reading

                    // Extract Details
                    const titleEl = await page.locator('.job-details-jobs-unified-top-card__job-title, h2.t-24').first();
                    const companyEl = await page.locator('.job-details-jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__subtitle').first();
                    const locationEl = await page.locator('.job-details-jobs-unified-top-card__bullet, .job-details-jobs-unified-top-card__workplace-type').first();

                    const title = await titleEl.innerText().catch(() => 'Unknown Title');
                    const company = await companyEl.innerText().catch(() => 'Unknown Company');
                    let location = await locationEl.innerText().catch(() => 'Unknown Location');

                    // Extract Description
                    let description = '';
                    const descEl = page.locator('#job-details');
                    if (await descEl.count() > 0) {
                        description = await descEl.innerText();
                    }

                    // Clean up fields
                    const cleanTitle = title.trim();
                    const cleanCompany = company.trim();
                    location = location.trim();

                    // URL - Current browser URL usually changes to the job ID, or we can get it from the card
                    let jobUrl = page.url();
                    // Try to get clean link from card if possible
                    const linkEl = item.locator('a.job-card-container__link').first();
                    const href = await linkEl.getAttribute('href').catch(() => null);
                    if (href) {
                        jobUrl = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
                        jobUrl = jobUrl.split('?')[0]; // Remove query params
                    }

                    console.log(`      📝 Extracted: ${cleanTitle.slice(0, 30)}... @ ${cleanCompany}`);

                    // --- FILTERING LOGIC ---
                    const fullText = `${cleanTitle} ${description} ${location}`.toLowerCase();

                    // 1. Keyword Check
                    if (!CONFIG.keywordRegex.test(fullText)) {
                        console.log(`      ❌ Filtered out: Missing Keyword (Golang)`);
                        continue;
                    }

                    // 2. Experience Check
                    if (CONFIG.excludeRegex.test(fullText)) {
                        console.log(`      ❌ Filtered out: Senior/Lead/Manager detected`);
                        continue;
                    }

                    // 3. Location Filter (Strict: No Hanoi)
                    const normalizedLoc = normalizeText(location);
                    const normalizedDesc = normalizeText(description);

                    // Combine location text for check
                    const locationCheckText = normalizedLoc + " " + normalizedDesc;

                    if (/\b(hn|hanoi|ha noi|thu do|ha noi city)\b/.test(locationCheckText)) {
                        console.log(`      ❌ Filtered out: Location is Hanoi`);
                        continue;
                    }

                    // Strict Location Preference (HCM / Can Tho)
                    // If not Hanoi, we accept it, but we can tag it properly
                    let finalLocation = 'Unknown';
                    if (/\b(hcm|ho chi minh|saigon|tphcm|hochiminh|tp hcm)\b/.test(locationCheckText)) {
                        finalLocation = 'HCM';
                    } else if (/\b(can tho|cantho)\b/.test(locationCheckText)) {
                        finalLocation = 'Can Tho';
                    } else if (/\b(remote)\b/.test(locationCheckText)) {
                        finalLocation = 'Remote'; // Accept remote
                    } else {
                        // If it's not Hanoi, and not HCM/Can Tho/Remote, but passed filters..
                        // Maybe "Vietnam" general? Keep as Unknown or raw location
                        finalLocation = location;
                    }

                    const job = {
                        title: cleanTitle,
                        company: cleanCompany,
                        url: jobUrl,
                        description: description.slice(0, 5000), // Cap description
                        location: finalLocation,
                        source: 'LinkedIn',
                        techStack: 'Golang',
                        postedDate: 'Past month', // Hardcoded as per user request (filtered by URL)
                        isFresher: true, // URL filters for fresher/entry
                        matchScore: 0
                    };

                    job.matchScore = calculateMatchScore(job);

                    if (job.matchScore >= 5) {
                        console.log(`      ✅ Valid Job! Score: ${job.matchScore}`);
                        jobs.push(job);
                    } else {
                        console.log(`      ❌ Low Score: ${job.matchScore}`);
                    }
                }

            } catch (e) {
                console.log(`      ⚠️ Error processing job ${i}: ${e.message}`);
                await screenshotDebugger.capture(page, `linkedin_job_error_${i}`);
            }
        }

    } catch (error) {
        console.error(`  ❌ LinkedIn Scrape Error: ${error.message}`);
        await screenshotDebugger.capture(page, 'linkedin_fatal_error');
    }

    const uniqueJobs = [...new Map(jobs.map(j => [j.url, j])).values()];
    return uniqueJobs;
}

module.exports = { scrapeLinkedIn };
