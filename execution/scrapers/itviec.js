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
                const searchUrl = `https://itviec.com/it-jobs/${keywordSlug}/${location.slug}`;

                console.log(`  🔍 Searching: ${keyword} - ${location.name} (Applying UI Filter)`);

                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // User requested 15s delay before interacting
                console.log('    ⏳ Waiting 15s before applying filters...');
                await page.waitForTimeout(15000);

                // ANTI-BOT: Check for Cloudflare challenge
                // Try to solve Turnstile automatically
                const pageTitle = await page.title().catch(() => '');
                if (pageTitle.includes('Attention Required') || pageTitle.includes('Just a moment') || pageTitle.includes('Cloudflare') || pageTitle.includes('bảo mật')) {
                    console.log('    🛡️ Cloudflare challenge detected on ITViec...');

                    try {
                        // Wait briefly for potential automated check
                        await page.waitForTimeout(3000);

                        // Attempt to locate Turnstile Widget
                        // Often inside an iframe with title "Widget containing a cloudflare security challenge"
                        // or just try to click the box if visible in main layout
                        const turnstileFrame = page.frames().find(f => f.url().includes('cloudflare') || f.name().includes('turnstile'));

                        if (turnstileFrame) {
                            console.log('    🤖 Found Cloudflare/Turnstile Frame, checking for checkbox...');
                            const checkbox = await turnstileFrame.locator('input[type="checkbox"], .ctp-checkbox-label, #challenge-stage').first();
                            if (await checkbox.isVisible()) {
                                await mouseJiggle(page); // Move mouse naturally towards it
                                await checkbox.click({ delay: Math.floor(Math.random() * 200) + 50 });
                                console.log('    🖱️ Clicked Turnstile checkbox!');
                                await page.waitForTimeout(5000); // Wait for reload
                            }
                        } else {
                            // Try clicking coordinate (center of screen often works for simple challenges)
                            // or looking for shadow root
                            console.log('    ⚠️ No specific iframe found, waiting...');
                        }

                        // Final Check
                        const finalTitle = await page.title();
                        if (finalTitle.includes('Attention Required') || finalTitle.includes('bảo mật') || finalTitle.includes('Cloudflare')) {
                            console.warn('    🚫 Cloudflare challenge persist after attempt. Skipping...');
                            await screenshotDebugger.captureAndSend(page, 'itviec-cloudflare-blocked', '🚨 ITViec: Blocked by Cloudflare (Challenge Failed)');
                            isBlocked = true;
                            break;
                        } else {
                            console.log('    ✅ Cloudflare challenge passed!');
                        }

                    } catch (e) {
                        console.warn(`    ⚠️ Error attempting Cloudflare solve: ${e.message}`);
                        // Don't break immediately, let the natural flow fail or succeed
                    }
                }

                // UI FILTER INTERACTION
                try {
                    // Click 'Level' dropdown
                    const levelDropdown = page.locator('#dropdown-job-level');
                    if (await levelDropdown.isVisible({ timeout: 5000 })) {
                        await levelDropdown.click();
                        await page.waitForTimeout(1000);

                        // Select 'Fresher'
                        // Checkbox might be hidden by label, usually need to click the label or force click the input
                        // The input is: <input class="checkbox-job-level" data-action="...submitFormInline" type="checkbox" value="Fresher" name="job_level_names[]" id="job_level_names_Fresher">
                        // The label is: <label for="job_level_names_Fresher">Fresher</label>

                        const fresherInput = page.locator('input[value="Fresher"][name="job_level_names[]"]');
                        const fresherLabel = page.locator('label[for*="Fresher"], label:has-text("Fresher")');

                        let clicked = false;

                        if (await fresherInput.count() > 0) {
                            // Try clicking input with force
                            await fresherInput.first().click({ force: true }).then(() => clicked = true).catch(() => { });
                        }

                        if (!clicked && await fresherLabel.count() > 0) {
                            // Try clicking label
                            await fresherLabel.first().click({ force: true }).then(() => clicked = true).catch(() => { });
                        }

                        if (!clicked) {
                            // JS force click
                            clicked = await page.evaluate(() => {
                                const el = document.querySelector('input[value="Fresher"][name="job_level_names[]"]');
                                if (el) { el.click(); return true; }
                                return false;
                            });
                        }

                        if (clicked) {
                            console.log('    🔽 UI Filter Applied: Fresher');
                            // Wait for network idle to ensure content reload
                            await page.waitForLoadState('networkidle').catch(() => { });
                            await page.waitForTimeout(2000); // Small buffer

                            // Click outside (body) to ensure dropdowns close
                            await page.locator('body').click({ force: true, position: { x: 1, y: 1 } }).catch(() => { });

                            // Attempt to close any potential modals covering the view
                            await page.keyboard.press('Escape').catch(() => { });

                            // VERIFY FILTER APPLIED
                            try {
                                // Selector provided: <span class="ilabel-warning position-absolute small-text text-it-white filter-number" data-jobs--filter-target="filterCounter">1</span>
                                // We use the robust data attribute.
                                // Fix: Use .first() to avoid strict mode violation if header becomes sticky
                                const filterBadge = page.locator('[data-jobs--filter-target="filterCounter"]').first();

                                // Wait for it to be visible
                                if (await filterBadge.isVisible({ timeout: 5000 })) {
                                    const countText = await filterBadge.textContent();
                                    const count = countText ? countText.trim() : '0';

                                    if (count === '1') {
                                        console.log('    ✅ Filter verification success: 1 active filter confirmed.');
                                    } else {
                                        throw new Error(`Filter verification failed. Expected '1' active filter, found '${count}'.`);
                                    }
                                } else {
                                    // Fallback: If badge is not visible, maybe it's 0 or hidden.
                                    console.warn('    ⚠️ Filter badge not visible, but proceeding cautiously...');
                                }
                            } catch (e) {
                                console.error(`    ❌ Filter verification FAILED: ${e.message}`);
                                await screenshotDebugger.captureAndSend(page, 'itviec-filter-failed', `🚨 ITViec: Filter failed for ${keyword} in ${location.name} (Badge != 1)`);
                                // Skip processing this keyword/location to avoid scraping unfiltered jobs
                                continue;
                            }

                        } else {
                            console.warn('    ⚠️ Failed to click Fresher filter (Element not found/interactable)');
                            // Also skip if we couldn't even click
                            continue;
                        }
                    } else {
                        console.log('    ℹ️ Level dropdown not found (Mobile view or Layout change), skipping filter.');
                        // Decide: Skip or continue without filter? User implies strict filtering.
                        // For safety, let's continue but warn. Or maybe skip?
                        // Current behavior was to log and continue. 
                        // Given the strict requirements, let's keep it as is but be aware.
                    }
                } catch (e) {
                    console.warn(`    ⚠️ UI Filter Error: ${e.message}`);
                    // If filter logic crashes, we probably shouldn't scrape unfiltered.
                    continue;
                }

                // 1. Check for Empty State (Robust)
                // Selector provided by user: div[data-jobs--filter-target="searchNoInfo"] (has d-none class if results exist)
                const emptyState = page.locator('div[data-jobs--filter-target="searchNoInfo"]:not(.d-none)');
                const noResultText = page.locator('h2[data-jobs--filter-target="textNoResult"]');

                if (await emptyState.count() > 0 && await emptyState.isVisible()) {
                    console.log(`    ⚠️ No jobs found for "${keyword}" in ${location.name} (Empty State Detected)`);
                    continue;
                }
                if (await noResultText.count() > 0 && await noResultText.isVisible()) {
                    console.log(`    ⚠️ No jobs found - Text "${await noResultText.textContent()}" detected.`);
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

                                // Capture Dynamic URL (Clean query params for caching)
                                const fullLink = page.url().split('?')[0];

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
                            // Timeout promise: 3 seconds max per card
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Card processing timeout')), 3000))
                        ]);

                    } catch (e) {
                        if (e.message === 'Card processing timeout') {
                            console.warn('      ⏱️ Card processing timed out (3s), skipping...');
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
