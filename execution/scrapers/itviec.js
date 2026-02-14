/**
 * ITViec Scraper
 */

const CONFIG = require('../config');
const { calculateMatchScore } = require('../lib/filters');
const ScreenshotDebugger = require('../lib/screenshot');

/**
 * Scrape jobs from ITViec
 * @param {import('playwright').Page} page 
 * @param {import('../lib/telegram')} reporter 
 */
async function scrapeITViec(page, reporter) {
    console.log('📋 Searching ITViec...');

    const screenshotDebugger = new ScreenshotDebugger(reporter);
    let isBlocked = false;

    const jobs = [];
    // User requested keyword 'golang' in the URL examples, but we should respect CONFIG if possible.
    // However, the user provided specific URLs: /it-jobs/golang/ho-chi-minh-hcm
    // We will use the CONFIG.keywords to construct these URLs dynamically.
    const keywords = CONFIG.keywords || ['golang'];

    // Configurable Locations based on user prompt (Ho Chi Minh, Can Tho)
    // We will map them to ITViec URL filtering structure if possible, 
    // but the user gave rigid URLs:
    // 1. https://itviec.com/it-jobs/golang/ho-chi-minh-hcm
    // 2. https://itviec.com/it-jobs/golang/can-tho
    // The structure seems to be /it-jobs/{keyword}/{location-slug}

    const locations = [
        { slug: 'ho-chi-minh-hcm', name: 'Ho Chi Minh' },
        { slug: 'can-tho', name: 'Can Tho' }
    ];

    // User requested 'Fresher' level filter.
    // Query param: job_levels[]=fresher (need to verify, but common convention)
    // Actually, looking at ITViec, it often uses query params for levels.
    // const jobLevelParam = 'job_levels%5B%5D=fresher'; // This is removed as per instruction

    for (const keyword of keywords) {
        if (isBlocked) break;
        // ITViec uses hyphens for keywords in URL usually (e.g. business-analyst)
        // For 'golang', it's just 'golang'.
        const keywordSlug = keyword.trim().toLowerCase().replace(/\s+/g, '-');

        for (const location of locations) {
            if (isBlocked) break;
            try {
                // Construct URL
                // Format: https://itviec.com/it-jobs/{keyword}/{location}?{params}
                // OR https://itviec.com/it-jobs/{keyword}?location={location}&params
                // User gave: https://itviec.com/it-jobs/golang/ho-chi-minh-hcm
                // Let's stick to the user's structure + query param for level.
                // User requested removing URL params for levels and using UI interaction instead.
                // Format: https://itviec.com/it-jobs/{keyword}/{location}
                const searchUrl = `https://itviec.com/it-jobs/${keywordSlug}/${location.slug}`;

                console.log(`  🔍 Searching: ${keyword} - ${location.name} (Applying UI Filter)`);

                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // ANTI-BOT: Check for Cloudflare challenge
                const pageTitle = await page.title().catch(() => '');
                if (pageTitle.includes('Attention Required') || pageTitle.includes('Just a moment') || pageTitle.includes('Cloudflare')) {
                    console.warn('    🛡️ Cloudflare challenge detected! 🚫 Skipping entire ITViec scraper...');
                    await screenshotDebugger.captureAndSend(page, 'itviec-cloudflare-blocked', '🚨 ITViec: Blocked by Cloudflare - Scraper terminally skipped');
                    isBlocked = true;
                    break;
                }

                // UI FILTER INTERACTION
                try {
                    // Click 'Level' dropdown
                    // Selector: div#dropdown-job-level
                    const levelDropdown = page.locator('#dropdown-job-level');

                    // CRITICAL FIX: Wait up to 10 seconds for dropdown to be visible
                    const isDropdownVisible = await levelDropdown.isVisible({ timeout: 10000 }).catch(() => false);

                    if (isDropdownVisible) {
                        await levelDropdown.click();

                        // Wait for dropdown animation
                        await page.waitForTimeout(1500);

                        // Select 'Fresher'
                        // CRITICAL FIX: Wait for checkbox to be visible and interactable
                        const fresherCheckbox = page.locator('input[value="Fresher"][name="job_level_names[]"][data-action*="submitFormInline"]');

                        // Wait for checkbox to appear (up to 10 seconds)
                        const isCheckboxVisible = await fresherCheckbox.first().isVisible({ timeout: 20000 }).catch(() => false);

                        if (isCheckboxVisible) {
                            // Scroll checkbox into view first
                            await fresherCheckbox.first().scrollIntoViewIfNeeded();
                            await page.waitForTimeout(500);

                            // Try to click with force, with timeout
                            try {
                                await fresherCheckbox.first().click({ force: true, timeout: 5000 });
                                console.log('    🔽 Filtered by Level: Fresher');
                            } catch (clickError) {
                                console.warn(`    ⚠️ Click failed: ${clickError.message}. Trying alternative method...`);
                                // Alternative: Click via JavaScript
                                await page.evaluate(() => {
                                    const checkbox = document.querySelector('input[value="Fresher"][name="job_level_names[]"]');
                                    if (checkbox) checkbox.click();
                                });
                                console.log('    🔽 Filtered by Level: Fresher (via JS)');
                            }

                            // Wait for results to update.
                            await page.waitForTimeout(3000);
                        } else {
                            console.warn('    ⚠️ Fresher checkbox not visible after 20s (headless mode?)');
                            console.warn('    ℹ️  Continuing without filter - will scrape all levels');
                        }
                    } else {
                        console.warn('    ⚠️ Level dropdown not found after 20s (headless mode?)');
                        console.warn('    ℹ️  Continuing without filter - will scrape all levels');
                    }
                } catch (e) {
                    console.warn(`    ⚠️ Failed to apply UI filter: ${e.message}`);
                    console.warn('    ℹ️  Continuing without filter - will scrape all levels');
                }

                // 1. Check for Empty State
                // Selector: div.search-noinfo[data-jobs--filter-target="searchNoInfo"]
                const emptyState = page.locator('div[data-jobs--filter-target="searchNoInfo"]');
                if (await emptyState.isVisible()) {
                    console.log(`    ⚠️ No jobs found for "${keyword}" in ${location.name} (Empty State Check)`);
                    continue;
                }

                // 2. Check Job Count Header
                // Selector: h1.headline-total-jobs
                const header = page.locator('h1.headline-total-jobs');
                if (await header.isVisible()) {
                    const countText = await header.textContent();
                    console.log(`    📊 Found: ${countText.trim().replace(/\s+/g, ' ')}`);
                }

                // Wait for job cards
                await page.waitForTimeout(2000);

                // 3. Select Job Cards
                // Selector: div.job-card
                // Ensure we are selecting from the list, not potentially the details pane (though details usually isn't a 'job-card')
                const jobCards = await page.locator('div.job-card').all();

                if (jobCards.length === 0) {
                    console.log(`    ⚠️ No job cards found (Selector Check)`);
                    continue;
                } else {
                    console.log(`    📦 Found ${jobCards.length} job cards`);
                }

                for (const item of jobCards.slice(0, 15)) {
                    try {
                        // CRITICAL FIX: Wrap entire card processing in timeout to prevent hanging
                        await Promise.race([
                            (async () => {
                                let card = item;

                                // Extract Basic Info from Card
                                // Title: <h3 ...>Title</h3>
                                const titleEl = card.locator('h3').first();
                                const title = await titleEl.textContent().catch(() => 'Unknown Title');

                                const company = await card.locator('a.text-rich-grey, span.text-rich-grey').first().textContent().catch(() => 'Unknown Company');

                                // Salary
                                const salary = await card.locator('div.salary span.ips-2').first().textContent().catch(() => 'Negotiable');

                                // Location (from card)
                                const locationText = await card.locator('div.text-rich-grey[title]').last().textContent().catch(() => location.name);

                                // Click to load details (Right Panel)
                                // Ensure we click the card container or the title to trigger selection
                                await card.scrollIntoViewIfNeeded();
                                await card.click({ force: true });

                                // Reduced wait time for faster processing
                                await page.waitForTimeout(300);

                                // Capture Dynamic URL
                                const fullLink = page.url();

                                // Wait for Detail Panel (should be visible quickly)
                                const detailPanel = page.locator('div.preview-job-content');

                                // Extract Details
                                let description = '';
                                // Fast check if visible with short timeout
                                const isPanelVisible = await detailPanel.isVisible({ timeout: 2000 }).catch(() => false);
                                if (isPanelVisible) {
                                    // CRITICAL: Reduced timeout to 1.5s to fail fast
                                    const jobDesc = await detailPanel.locator('.job-description').innerText({ timeout: 1500 }).catch(() => '');
                                    const jobSkills = await detailPanel.locator('.job-experiences').innerText({ timeout: 1500 }).catch(() => '');
                                    description = `${jobDesc}\n\n${jobSkills}`;
                                }

                                // Cleanup
                                const job = {
                                    title: title.trim(),
                                    company: company.trim(),
                                    url: fullLink,
                                    salary: salary.trim(),
                                    location: locationText.trim(),
                                    source: 'ITViec',
                                    description: description.trim().slice(0, 5000), // Keep full for filtering first
                                    techStack: 'Golang' // Placeholder
                                };

                                job.matchScore = calculateMatchScore(job);

                                // Filters
                                if (CONFIG.excludeRegex.test(job.title)) return;

                                // High YoE Check (Strict > 3 years)
                                if (description && /\b([3-9]|\d{2,})\s*(\+|plus)?\s*(năm|nam|years?|yoe)\b/i.test(description)) {
                                    return;
                                }

                                // Config Keyword Check
                                const kLower = keyword.toLowerCase();
                                if (!job.title.toLowerCase().includes(kLower) && !job.description.toLowerCase().includes(kLower)) {
                                    return;
                                }

                                // Truncate description for output/log as requested
                                job.description = job.description.slice(0, 100) + '...';

                                jobs.push(job);
                                console.log(`      ✅ ${job.title} - ${job.company}`);
                            })(),
                            // Timeout promise: 8 seconds max per card
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Card processing timeout')), 8000))
                        ]);

                    } catch (e) {
                        if (e.message === 'Card processing timeout') {
                            console.warn('      ⏱️ Card processing timed out (8s), skipping...');
                        }
                        // Silent fail for other errors
                    }
                }

            } catch (error) {
                console.error(`  ⚠️ ITViec Error for ${keyword} in ${location.name}: ${error.message}`);
            }
        }
    }

    return jobs;
}

module.exports = { scrapeITViec };
