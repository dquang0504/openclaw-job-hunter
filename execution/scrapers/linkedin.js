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

    // --- WARM UP PHASE & LOGIN CHECK ---
    try {
        console.log('🏠 Navigating to LinkedIn Feed for warm-up...');
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Verify Login
        try {
            await page.waitForSelector('#global-nav', { timeout: 10000 });
            console.log('    ✅ Login confirmed (Global Nav found).');
        } catch (e) {
            console.error('    ❌ Login Verification Failed! Cookies might be invalid.');
            await screenshotDebugger.captureAndSend(page, 'linkedin_login_failed');
            throw new Error('LinkedIn Login Failed - navigation bar not found');
        }

        // Randomize warm-up duration (2-4s)
        const warmUpDuration = 2000 + Math.random() * 2000;
        const startTime = Date.now();
        console.log(`⏳ Warming up for ${(warmUpDuration / 1000).toFixed(1)}s with random behaviors...`);

        while (Date.now() - startTime < warmUpDuration) {
            await mouseJiggle(page);
            await page.waitForTimeout(1000 + Math.random() * 1000);
        }
    } catch (e) {
        if (e.message.includes('Login Failed')) throw e; // Re-throw fatal login error
        console.log('⚠️ Warm-up failed (non-critical):', e.message);
    }
    // --- END WARM UP ---

    // Define Keywords to Scrape
    const LINKEDIN_KEYWORDS = [
        'fresher golang',
        'entry level golang',
        'intern golang'
    ];

    try {
        for (const keyword of LINKEDIN_KEYWORDS) {
            console.log(`\n🔑 Processing Keyword: "${keyword}"`);
            const encodedKeyword = encodeURIComponent(keyword);

            // --- STEP 1: JOB SEARCH ---
            // Construct dynamic Job Search URL based on user's request
            // Added f_TPR=r2592000 (Past Month) to ensure relevance
            const JOB_SEARCH_URL = `https://www.linkedin.com/jobs/search/?f_E=1%2C2%2C3&keywords=${encodedKeyword}&origin=JOB_SEARCH_PAGE_JOB_FILTER&f_TPR=r2592000`;

            console.log(`  🌐 Visiting Job Search: ${JOB_SEARCH_URL}`);
            await page.goto(JOB_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Wait for job list
            console.log('    ⏳ Waiting for job list...');
            try {
                // Wait for any list item to appear
                await page.waitForSelector('li.scaffold-layout__list-item, .job-card-container', { timeout: 15000 });
            } catch (e) {
                console.log('    ⚠️ Main list selector not found, trying fallback...');
                await screenshotDebugger.captureAndSend(page, 'linkedin_job_list_missing');
                if (await page.locator('h1.artdeco-empty-state__headline').count() > 0) {
                    console.log('    ⚠️ No jobs found for this keyword.');
                }
            }

            await randomDelay(2000, 3000);
            await humanScroll(page, 3); // Scroll down

            const jobItemsSelector = 'li.scaffold-layout__list-item, li.jobs-search-results__list-item';
            const jobItems = await page.locator(jobItemsSelector).all();
            console.log(`    📄 Found ${jobItems.length} potential jobs for "${keyword}".`);

            const maxJobs = Math.min(jobItems.length, 5); // Limit 5

            for (let i = 0; i < maxJobs; i++) {
                try {
                    const item = jobItems[i];
                    const card = item.locator('.job-card-container').first();

                    if (await card.isVisible()) {
                        console.log(`    👆 Clicking job ${i + 1}/${maxJobs}...`);
                        await card.scrollIntoViewIfNeeded();
                        await card.click();

                        await page.waitForTimeout(1000);
                        try {
                            await page.waitForSelector('#job-details', { timeout: 5000 });
                        } catch (e) { }

                        await randomDelay(500, 1000); // Reduced delay

                        // Extract Details (Updated Selector)
                        const titleEl = await page.locator('.job-details-jobs-unified-top-card__job-title, h2.t-24').first();
                        const companyEl = await page.locator('.job-details-jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__subtitle').first();

                        // New Primary Description Container for Location & Date
                        const primaryDescEl = page.locator('.job-details-jobs-unified-top-card__primary-description-container').first();
                        let locationRaw = 'Unknown Location';
                        let postedDate = 'Past month';

                        if (await primaryDescEl.count() > 0) {
                            const descText = await primaryDescEl.innerText();
                            // Format: "Ho Chi Minh City, Vietnam · 6 days ago · 16 people clicked apply"
                            const parts = descText.split('·').map(s => s.trim());
                            if (parts.length > 0) locationRaw = parts[0]; // First part is usually location

                            // Find date part
                            const dateMatch = descText.match(/(\d+\s+(?:minute|hour|day|week|month)s?\s+ago)/i);
                            if (dateMatch) postedDate = dateMatch[1];
                        } else {
                            // Fallback
                            const locationEl = await page.locator('.job-details-jobs-unified-top-card__bullet, .job-details-jobs-unified-top-card__workplace-type').first();
                            locationRaw = await locationEl.innerText().catch(() => 'Unknown Location');
                        }

                        const title = await titleEl.innerText().catch(() => 'Unknown Title');
                        const company = await companyEl.innerText().catch(() => 'Unknown Company');

                        let description = '';
                        const descEl = page.locator('#job-details');
                        if (await descEl.count() > 0) description = await descEl.innerText();

                        const cleanTitle = title.trim();
                        const cleanCompany = company.trim();
                        const cleanLocation = locationRaw.trim();

                        // Clean URL
                        let jobUrl = page.url();
                        const linkEl = item.locator('a.job-card-container__link').first();
                        const href = await linkEl.getAttribute('href').catch(() => null);
                        if (href) {
                            jobUrl = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
                            jobUrl = jobUrl.split('?')[0];
                        }

                        // --- FILTERING ---
                        const fullText = `${cleanTitle} ${description} ${cleanLocation}`.toLowerCase();

                        // Keywords & Experience
                        // Keywords & Experience
                        if (!CONFIG.keywordRegex.test(fullText)) {
                            console.log(`      ❌ Filtered: Missing Keyword (Golang) in ${cleanTitle}`);
                            continue;
                        }
                        if (CONFIG.excludeRegex.test(fullText)) {
                            console.log(`      ❌ Filtered: Senior/Lead detected in ${cleanTitle}`);
                            continue;
                        }

                        // Location Filter (Updated Logic)
                        const normalizedLoc = normalizeText(cleanLocation);
                        const normalizedDesc = normalizeText(description);
                        const locCheck = normalizedLoc + " " + normalizedDesc;

                        // 1. Exclude Hanoi
                        if (/\b(hn|hanoi|ha noi|thu do|ha noi city)\b/.test(locCheck)) {
                            console.log(`      ❌ Filtered out: Location is Hanoi`);
                            continue;
                        }

                        // 2. Identify Location (HCM, Can Tho, Remote)
                        let finalLocation = 'Unknown';
                        if (/\b(hcm|ho chi minh|saigon|tphcm|hochiminh|tp hcm)\b/.test(locCheck)) {
                            finalLocation = 'HCM';
                        } else if (/\b(can tho|cantho)\b/.test(locCheck)) {
                            finalLocation = 'Can Tho';
                        } else if (/\b(remote)\b/.test(locCheck)) {
                            finalLocation = 'Remote';
                        } else {
                            // Keep raw if not Hanoi and not specifically matched
                            finalLocation = cleanLocation;
                        }

                        const job = {
                            title: cleanTitle,
                            company: cleanCompany,
                            url: jobUrl,
                            description: description.slice(0, 5000),
                            location: finalLocation,
                            source: 'LinkedIn',
                            techStack: 'Golang',
                            postedDate: postedDate,
                            isFresher: true,
                            matchScore: 0
                        };

                        job.matchScore = calculateMatchScore(job);
                        if (job.matchScore >= 5) {
                            console.log(`      ✅ Valid Job! Score: ${job.matchScore} - ${finalLocation} - ${postedDate}`);
                            jobs.push(job);
                        } else {
                            console.log(`      ⚠️ Low Score (${job.matchScore}): ${cleanTitle} @ ${cleanCompany}`);
                        }
                    }
                } catch (e) {
                    console.log(`      ⚠️ Job Error: ${e.message}`);
                    await screenshotDebugger.captureAndSend(page, `linkedin_job_w_${i}`);
                }
            }

            // --- STEP 2: POST SEARCH ---
            const POST_SEARCH_URL = `https://www.linkedin.com/search/results/CONTENT/?keywords=${encodedKeyword}&origin=FACETED_SEARCH&sid=p8A&sortBy=%22date_posted%22`;
            console.log(`  📝 Visiting Post Search: ${POST_SEARCH_URL}`);

            await page.goto(POST_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await randomDelay(2000, 3000);
            await humanScroll(page, 5);

            const updateSelector = 'div.feed-shared-update-v2';

            // Explicitly wait for posts to load
            try {
                await page.waitForSelector(updateSelector, { timeout: 15000 });
            } catch (e) {
                console.log('      ⚠️ Posts selector not found (might be no results).');
                await screenshotDebugger.captureAndSend(page, 'linkedin_post_list_missing');
            }

            const updates = await page.locator(updateSelector).all();
            console.log(`    📄 Found ${updates.length} potential posts for "${keyword}".`);

            const maxPosts = Math.min(updates.length, 5); // Limit 5 posts per keyword

            for (let i = 0; i < maxPosts; i++) {
                try {
                    const update = updates[i];

                    // Time Check
                    const subDescEl = update.locator('span.update-components-actor__sub-description').first();
                    const subDescText = await subDescEl.innerText().catch(() => '');
                    const timeMatch = subDescText.match(/^(\d+)([hmgs]|h|m|g)(?:\s|•|$)/);

                    let isRecent = false;
                    let timeString = 'Unknown';

                    if (timeMatch) {
                        const val = parseInt(timeMatch[1]);
                        const unit = timeMatch[2];
                        timeString = timeMatch[0].replace('•', '').trim();
                        if (['m', 's'].includes(unit) || (['h', 'g'].includes(unit) && val <= 6)) {
                            isRecent = true;
                        }
                    } else if (subDescText.includes('now') || subDescText.includes('vừa xong')) {
                        isRecent = true;
                        timeString = 'Now';
                    }

                    if (!isRecent) continue;

                    // Expand Content
                    const moreBtn = update.locator('button.feed-shared-inline-show-more-text__see-more-less-toggle').first();
                    if (await moreBtn.isVisible()) {
                        await moreBtn.click().catch(() => { });
                        await page.waitForTimeout(500);
                    }

                    const contentEl = update.locator('div.feed-shared-update-v2__description').first();
                    const contentText = await contentEl.innerText().catch(() => '');

                    if (contentText.length < 50) continue;

                    const actorNameEl = update.locator('.update-components-actor__name').first();
                    const authorName = await actorNameEl.innerText().catch(() => 'LinkedIn User');

                    // URL
                    const urn = await update.getAttribute('data-urn').catch(() => null);
                    const postUrl = urn ? `https://www.linkedin.com/feed/update/${urn}` : page.url();

                    // Filtering
                    const fullText = `${authorName} ${contentText}`.toLowerCase();

                    if (!CONFIG.keywordRegex.test(fullText)) continue;
                    if (CONFIG.excludeRegex.test(fullText)) continue;

                    // Location Filter (Posts)
                    if (/\b(hn|hanoi|ha noi|thu do|ha noi city)\b/.test(fullText)) {
                        console.log(`      ❌ Filtered out (Post): Location is Hanoi`);
                        continue;
                    }

                    // Priority Location check for Posts (Optional, but good for scoring)
                    let postLocation = 'Unknown';
                    if (/\b(hcm|ho chi minh|saigon|tphcm)\b/.test(fullText)) postLocation = 'HCM';
                    else if (/\b(can tho)\b/.test(fullText)) postLocation = 'Can Tho';
                    else if (/\b(remote)\b/.test(fullText)) postLocation = 'Remote';

                    const job = {
                        title: `[Post] ${authorName} is hiring`,
                        company: authorName,
                        url: postUrl,
                        description: contentText.slice(0, 5000),
                        location: postLocation, // Pass detected or Unknown
                        source: 'LinkedIn (Post)',
                        techStack: 'Golang',
                        postedDate: timeString,
                        isFresher: true,
                        matchScore: 0
                    };

                    job.matchScore = calculateMatchScore(job);
                    if (job.matchScore >= 5) {
                        console.log(`      ✅ Valid Post! Score: ${job.matchScore}`);
                        jobs.push(job);
                    }
                } catch (e) {
                    console.log(`      ⚠️ Post Error: ${e.message}`);
                    await screenshotDebugger.captureAndSend(page, `linkedin_post_error_${i}`);
                }
            }

            await randomDelay(2000, 3000); // Wait between keywords
        }

    } catch (error) {
        console.error(`  ❌ LinkedIn Scrape Error: ${error.message}`);
        await screenshotDebugger.captureAndSend(page, 'linkedin_fatal_error');
    }

    const uniqueJobs = [...new Map(jobs.map(j => [j.url, j])).values()];
    return uniqueJobs;
}

module.exports = { scrapeLinkedIn };
