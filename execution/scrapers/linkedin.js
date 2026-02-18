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

        // --- STEP 2: SCRAPE LINKEDIN POSTS ---
        // URL provided by user (Latest Date Posted)
        const POST_SEARCH_URL = 'https://www.linkedin.com/search/results/CONTENT/?keywords=fresher%20golang&origin=FACETED_SEARCH&sid=sYp&sortBy=%22date_posted%22';

        console.log(`  📝 Visiting Post Search: ${POST_SEARCH_URL}`);
        await page.goto(POST_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

        await randomDelay(2000, 3000);
        await humanScroll(page, 5); // Scroll to load feed

        // Selectors
        const postContainerSelector = 'div.update-components-update-v2__commentary';
        // The container that holds the post usually is parent of commentary or similar
        // Let's iterate over feed updates
        const updateSelector = 'div.feed-shared-update-v2';

        const updates = await page.locator(updateSelector).all();
        console.log(`    📄 Found ${updates.length} potential posts in feed.`);

        const maxPosts = Math.min(updates.length, 10);

        for (let i = 0; i < maxPosts; i++) {
            try {
                const update = updates[i];

                // 1. Check Time First (Optimization)
                // Selector provided: span.update-components-actor__sub-description
                const subDescEl = update.locator('span.update-components-actor__sub-description').first();
                const subDescText = await subDescEl.innerText().catch(() => '');

                // Extract time part (e.g. "9h •", "1d •")
                // User requirement: "6h" or "6 giờ" or less.
                // Regex for time format
                const timeMatch = subDescText.match(/^(\d+)([hmgs]|h|m|g)(?:\s|•|$)/);
                // Matches "9h", "10m", "6g" (hours/minutes/gio)

                let isRecent = false;
                let timeString = 'Unknown';

                if (timeMatch) {
                    const val = parseInt(timeMatch[1]);
                    const unit = timeMatch[2]; // h, m, g, s
                    timeString = timeMatch[0].replace('•', '').trim();

                    if (unit === 'm' || unit === 's') {
                        isRecent = true; // Minutes/Seconds always recent
                    } else if (unit === 'h' || unit === 'g') {
                        // Check <= 6 hours
                        if (val <= 6) isRecent = true;
                    }
                    // Days (d) are excluded
                } else if (subDescText.includes('now') || subDescText.includes('vừa xong')) {
                    isRecent = true;
                    timeString = 'Now';
                }

                if (!isRecent) {
                    // console.log(`      Skipping old post: ${subDescText.slice(0, 20)}...`);
                    continue;
                }

                console.log(`    🕒 Inspecting Recent Post (${timeString})...`);

                // 2. Expand Content (Click "...more")
                const moreBtn = update.locator('button.feed-shared-inline-show-more-text__see-more-less-toggle').first();
                if (await moreBtn.isVisible()) {
                    await moreBtn.click().catch(() => { });
                    await page.waitForTimeout(500);
                }

                // 3. Extract Content
                const contentEl = update.locator('div.feed-shared-update-v2__description').first();
                const contentText = await contentEl.innerText().catch(() => '');

                if (contentText.length < 50) continue; // Skip empty/short

                // 4. Extract Author/Company (from Actor header)
                const actorNameEl = update.locator('.update-components-actor__name').first();
                const authorName = await actorNameEl.innerText().catch(() => 'LinkedIn User');

                // 5. Extract URL (URN)
                const urn = await update.getAttribute('data-urn').catch(() => null);
                let postUrl = page.url();
                if (urn) {
                    // urn:li:activity:7123... -> https://www.linkedin.com/feed/update/urn:li:activity:7123...
                    postUrl = `https://www.linkedin.com/feed/update/${urn}`;
                }

                console.log(`      📝 Post by ${authorName}: ${contentText.slice(0.40)}...`);

                // 6. Filtering
                const fullText = `${authorName} ${contentText}`.toLowerCase();

                // Keyword Check
                if (!CONFIG.keywordRegex.test(fullText)) {
                    console.log(`      ❌ Filtered out: Missing Keyword`);
                    continue;
                }

                // Senior/High Exp Check
                if (CONFIG.excludeRegex.test(fullText)) {
                    console.log(`      ❌ Filtered out: Senior/Lead`);
                    continue;
                }

                // Location Check (Strict No Hanoi)
                // Note: Post content location is informal. We rely on text regex.
                if (/\b(hn|hanoi|ha noi|thu do|ha noi city)\b/.test(fullText)) {
                    console.log(`      ❌ Filtered out: Location is Hanoi`);
                    continue;
                }

                // For Posts, we don't strictly require HCM keyword because users might not tag it clearly.
                // But user context implies strict rule? 
                // "Location thường nó để trong post luôn á... AI validator sẽ detect"
                // So we pass it to AI validator if it passes keyword check + No Hanoi check.

                const job = {
                    title: `[Post] ${authorName} is hiring`, // Placeholder title
                    company: authorName,
                    url: postUrl,
                    description: contentText.slice(0, 5000),
                    location: 'Unknown', // Let AI detect
                    source: 'LinkedIn (Post)',
                    techStack: 'Golang',
                    postedDate: timeString, // "4h", "Now"
                    isFresher: true, // From keyword search
                    matchScore: 0
                };

                // Pre-calc score
                job.matchScore = calculateMatchScore(job);

                if (job.matchScore >= 5) {
                    console.log(`      ✅ Valid Post! Score: ${job.matchScore}`);
                    jobs.push(job);
                }

            } catch (e) {
                console.log(`      ⚠️ Error processing post ${i}: ${e.message}`);
                await screenshotDebugger.capture(page, `linkedin_post_error_${i}`);
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
