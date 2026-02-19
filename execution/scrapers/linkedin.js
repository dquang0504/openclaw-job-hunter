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
            // Construct dynamic Job Search URL based on user's request (Updated filters)
            const JOB_SEARCH_URL = `https://www.linkedin.com/jobs/search/?currentJobId=4329358250&f_E=1%2C2%2C3&f_TPR=r2592000&f_WT=1%2C3&geoId=104195383&keywords=${encodedKeyword}&origin=JOB_SEARCH_PAGE_JOB_FILTER&refresh=true`;

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

            const maxScan = Math.min(jobItems.length, 20); // Check up to 20
            const jobUrls = [];
            let jobsFoundForKeyword = 0; // Track valid jobs for this keyword

            // 1. Extract URLs first
            for (let i = 0; i < maxScan; i++) {
                const item = jobItems[i];
                const linkEl = item.locator('a.job-card-container__link').first();
                const href = await linkEl.getAttribute('href').catch(() => null);
                if (href) {
                    let fullUrl = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
                    fullUrl = fullUrl.split('?')[0];
                    jobUrls.push(fullUrl);
                }
            }

            console.log(`    🔗 Extracted ${jobUrls.length} links. Processing...`);

            // 2. Process in Batches of 5 to avoid overloading
            const BATCH_SIZE = 5;
            for (let i = 0; i < jobUrls.length; i += BATCH_SIZE) {
                if (jobsFoundForKeyword >= 5) break; // Stop if we have enough valid jobs

                const batchUrls = jobUrls.slice(i, i + BATCH_SIZE);
                // console.log(`      🚀 Processing Batch ${i/BATCH_SIZE + 1} (${batchUrls.length} jobs)...`);

                const jobPromises = batchUrls.map(async (url) => {
                    const jobPage = await context.newPage();
                    try {
                        // console.log(`      🚀 Opening Job ${index + 1}: ${url}`);
                        await jobPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                        // Wait for content - Fail Fast if blocked or not loading
                        try {
                            await jobPage.waitForSelector('.job-details-jobs-unified-top-card__primary-description-container, .job-details-jobs-unified-top-card__job-title', { timeout: 5000 });
                        } catch (e) {
                            console.log(`      ⚠️ Job details not found for ${url}`);
                            // Check if we hit a wall
                            if (await jobPage.locator('.auth-wall__content, #join-form, .join-form').count() > 0) {
                                console.log('      ⚠️ Hit Auth Wall / Login Form');
                            }
                            await screenshotDebugger.captureAndSend(jobPage, `linkedin_job_load_fail_${Date.now()}`);
                            return null; // Skip this job
                        }

                        // Extract Details (Detail Page Selectors)
                        const titleEl = await jobPage.locator('.job-details-jobs-unified-top-card__job-title, h1').first();
                        const companyEl = await jobPage.locator('.job-details-jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__subtitle').first();

                        // Try primary description (User's observation: p tag with 'ago' or structure)
                        let primaryDescEl = jobPage.locator('.job-details-jobs-unified-top-card__primary-description-container').first();

                        // Fallback: User's observed structure (p tag containing '·' and time indicators)
                        if (await primaryDescEl.count() === 0) {
                            primaryDescEl = jobPage.locator('p').filter({ hasText: /·.*(ago|vừa|trước)/ }).first();
                        }
                        let locationRaw = 'Unknown Location';
                        let postedDate = 'Past month';

                        if (await primaryDescEl.count() > 0) {
                            const descText = await primaryDescEl.innerText();
                            // Format: "Ho Chi Minh City, Vietnam · 6 days ago · 16 people clicked apply"
                            const parts = descText.split('·').map(s => s.trim());
                            if (parts.length > 0) locationRaw = parts[0];

                            const dateMatch = descText.match(/(\d+\s+(?:minute|hour|day|week|month)s?\s+ago)/i);
                            if (dateMatch) postedDate = dateMatch[1];
                        } else {
                            const locationEl = await jobPage.locator('.job-details-jobs-unified-top-card__bullet, .job-details-jobs-unified-top-card__workplace-type').first();
                            locationRaw = await locationEl.innerText().catch(() => 'Unknown Location');
                        }

                        const title = await titleEl.innerText().catch(() => 'Unknown Title');
                        const company = await companyEl.innerText().catch(() => 'Unknown Company');

                        // Description - Support [data-testid="expandable-text-box"] per user request
                        let description = '';
                        const descEl = jobPage.locator('[data-testid="expandable-text-box"], #job-details, .jobs-description__content').first();

                        // If expandable, try to ensure it's expanded? Usually fully loaded in this view.
                        if (await descEl.count() > 0) {
                            description = await descEl.innerText();
                        } else {
                            // Fallback to older selectors
                            const oldDescEl = jobPage.locator('.jobs-description-content__text').first();
                            if (await oldDescEl.count() > 0) description = await oldDescEl.innerText();
                        }

                        const cleanTitle = title.trim();
                        const cleanLocation = locationRaw.trim();

                        // --- FILTERING ---
                        const fullText = `${cleanTitle} ${description} ${cleanLocation}`.toLowerCase();

                        // Keywords & Experience
                        if (!CONFIG.keywordRegex.test(fullText)) {
                            console.log(`      ❌ [Target Failed] Missing Keyword: ${cleanTitle}`);
                            return null;
                        }
                        if (CONFIG.excludeRegex.test(fullText)) {
                            console.log(`      ❌ [Target Failed] Senior/Lead: ${cleanTitle}`);
                            return null;
                        }

                        // Location Logic
                        const normalizedLoc = normalizeText(cleanLocation);
                        const normalizedDesc = normalizeText(description);
                        const locCheck = normalizedLoc + " " + normalizedDesc;

                        if (/\b(hn|hanoi|ha noi|thu do|ha noi city)\b/.test(locCheck)) {
                            console.log(`      ❌ [Target Failed] Location Hanoi`);
                            return null;
                        }

                        let finalLocation = 'Unknown';
                        if (/\b(hcm|ho chi minh|saigon|tphcm)\b/.test(locCheck)) finalLocation = 'HCM';
                        else if (/\b(can tho|cantho)\b/.test(locCheck)) finalLocation = 'Can Tho';
                        else if (/\b(remote)\b/.test(locCheck)) finalLocation = 'Remote';
                        else finalLocation = cleanLocation;

                        const job = {
                            title: cleanTitle,
                            company: company.trim(),
                            url: url,
                            description: description.slice(0, 5000),
                            location: finalLocation,
                            source: 'LinkedIn',
                            techStack: 'Golang',
                            postedDate: postedDate,
                            isFresher: true, // Default, logic handled by filter
                            matchScore: 0
                        };

                        job.matchScore = calculateMatchScore(job);
                        if (job.matchScore >= 5) {
                            console.log(`      ✅ Valid Job! ${job.matchScore}pts - ${finalLocation} - ${postedDate}`);
                            return job;
                        } else {
                            console.log(`      ⚠️ Low Score (${job.matchScore}): ${cleanTitle}`);
                            return null;
                        }

                    } catch (e) {
                        console.log(`      ⚠️ Job Processing Error: ${e.message}`);
                        return null;
                    } finally {
                        await jobPage.close();
                    }
                });

                const results = await Promise.all(jobPromises);
                const validNewJobs = results.filter(j => j !== null);
                jobs.push(...validNewJobs);
                jobsFoundForKeyword += validNewJobs.length;
            } // End Batch Loop

            console.log(`    ✨ Found ${jobsFoundForKeyword} valid jobs for "${keyword}" (Scanned ${jobUrls.length}).`);

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

            const maxPosts = Math.min(updates.length, 8); // Scan up to 8, take 4 valid
            let postsFound = 0;

            for (let i = 0; i < maxPosts; i++) {
                if (postsFound >= 4) break; // Limit 4 valid posts
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
                        if (['m', 's'].includes(unit) || (['h', 'g'].includes(unit) && val <= 8)) { // Updated to 8h
                            isRecent = true;
                        }
                    } else if (subDescText.includes('now') || subDescText.includes('vừa xong')) {
                        isRecent = true;
                        timeString = 'Now';
                    }

                    // Fallback to update-components-actor__sub-description structure if main check fails
                    if (!isRecent) {
                        const preciseTimeEl = update.locator('.update-components-actor__sub-description span[aria-hidden="true"]').first();
                        const preciseTimeText = await preciseTimeEl.innerText().catch(() => '');
                        if (preciseTimeText.match(/(\d+)([hm])\s*•/)) {
                            // Re-evaluate with this text
                            const pMatch = preciseTimeText.match(/(\d+)([hm])/);
                            if (pMatch) {
                                const pVal = parseInt(pMatch[1]);
                                const pUnit = pMatch[2];
                                if (pUnit === 'm' || (pUnit === 'h' && pVal <= 8)) isRecent = true;
                            }
                        }
                    }

                    if (!isRecent) continue;

                    if (!isRecent) continue;

                    // Expand Content (Updated Selector)
                    // The button class often contains 'feed-shared-inline-show-more-text__see-more-less-toggle'
                    const moreBtn = update.locator('button.feed-shared-inline-show-more-text__see-more-less-toggle').first();
                    if (await moreBtn.isVisible()) {
                        try {
                            // console.log('      Trying to expand post content...');
                            await moreBtn.click({ force: true });
                            await page.waitForTimeout(500);
                        } catch (e) { /* Ignore click error */ }
                    }

                    const contentEl = update.locator('div.feed-shared-update-v2__description, .update-components-text').first();
                    let contentText = await contentEl.innerText().catch(() => '');

                    if (contentText.length < 50) continue;

                    if (contentText.length < 50) continue;

                    // Actor Name specific selector based on user structure
                    const actorNameEl = update.locator('.update-components-actor__title span[dir="ltr"] span[aria-hidden="true"]').first();
                    const authorName = await actorNameEl.innerText().catch(() => 'LinkedIn User');

                    // Create a meaningful title from content
                    const contentSnippet = contentText.split('\n')[0].slice(0, 80).trim();
                    const postTitle = contentSnippet.length > 0 ? `[Post] ${contentSnippet}...` : `[Post] ${authorName} is hiring`;

                    // URL
                    const urn = await update.getAttribute('data-urn').catch(() => null);
                    const postUrl = urn ? `https://www.linkedin.com/feed/update/${urn}` : page.url();

                    // Filtering
                    const fullText = `${authorName} ${contentText}`.toLowerCase();

                    if (!CONFIG.keywordRegex.test(fullText)) {
                        console.log(`      ❌ Filtered (Post): Keyword missed in "${contentText.slice(0, 30)}..."`);
                        continue;
                    }
                    if (CONFIG.excludeRegex.test(fullText)) {
                        console.log(`      ❌ Filtered (Post): Senior/Lead in "${contentText.slice(0, 30)}..."`);
                        continue;
                    }

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
                        title: postTitle,
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
                        const snippet = job.title;
                        console.log(`      ✅ Valid Post! Score: ${job.matchScore} - "${snippet}"`);
                        jobs.push(job);
                        postsFound++;
                    } else {
                        console.log(`      ⚠️ Low Score Post (${job.matchScore}): "${job.title}"`);
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
