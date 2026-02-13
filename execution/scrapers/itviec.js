/**
 * ITViec Scraper
 */

const CONFIG = require('../config');
const { calculateMatchScore } = require('../lib/filters');

/**
 * Scrape jobs from ITViec
 * @param {import('playwright').Page} page 
 * @param {import('../lib/telegram')} reporter 
 */
async function scrapeITViec(page, reporter) {
    console.log('📋 Searching ITViec...');

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
        // ITViec uses hyphens for keywords in URL usually (e.g. business-analyst)
        // For 'golang', it's just 'golang'.
        const keywordSlug = keyword.trim().toLowerCase().replace(/\s+/g, '-');

        for (const location of locations) {
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

                // UI FILTER INTERACTION
                try {
                    // Click 'Level' dropdown
                    // Selector: div#dropdown-job-level
                    const levelDropdown = page.locator('#dropdown-job-level');
                    // Wait for it to be ready
                    if (await levelDropdown.isVisible()) {
                        await levelDropdown.click();

                        // Select 'Fresher'
                        // ISSUE: Previously matched 2 elements.
                        // Target: input[value="Fresher"][data-action*="submitFormInline"] 
                        // Or simply use .first() if we see the dropdown is open.
                        const fresherCheckbox = page.locator('input[value="Fresher"][name="job_level_names[]"][data-action*="submitFormInline"]');

                        if (await fresherCheckbox.count() > 0) {
                            // Force click because sometimes label overlay intercepts or opacity issues
                            await fresherCheckbox.first().click({ force: true });
                            console.log('    🔽 Filtered by Level: Fresher');

                            // Wait for results to update.
                            await page.waitForTimeout(3000);
                        } else {
                            console.warn('    ⚠️ Fresher filter option not found (Selector mismatch)');
                        }
                    } else {
                        console.warn('    ⚠️ Level dropdown not found');
                    }
                } catch (e) {
                    console.warn(`    ⚠️ Failed to apply UI filter: ${e.message}`);
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

                        // Speed optimization: Short fix wait instead of waiting for specific element changes if site is fast
                        // User requested "Super fast"
                        await page.waitForTimeout(500);

                        // Capture Dynamic URL
                        const fullLink = page.url();

                        // Wait for Detail Panel (should be visible quickly)
                        const detailPanel = page.locator('div.preview-job-content');

                        // Extract Details
                        let description = '';
                        // Fast check if visible
                        if (await detailPanel.isVisible()) {
                            // Combine Job Description and Skills/Experience
                            // Use innerText to preserve newlines for better regex matching
                            // And select the whole section, not just .paragraph as items are often in ul/li
                            const jobDesc = await detailPanel.locator('.job-description').innerText().catch(() => '');
                            const jobSkills = await detailPanel.locator('.job-experiences').innerText().catch(() => '');
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
                        if (CONFIG.excludeRegex.test(job.title)) continue;

                        // High YoE Check (Strict > 3 years)
                        // Debug: Log if suspicious text found to verify extraction
                        if (description && /\b([3-9]|\d{2,})\s*(\+|plus)?\s*(năm|nam|years?|yoe)\b/i.test(description)) {
                            console.log(`      ⚠️ Skipped (High YoE in desc): ${title}`);
                            continue;
                        }

                        // Config Keyword Check
                        const kLower = keyword.toLowerCase();
                        if (!job.title.toLowerCase().includes(kLower) && !job.description.toLowerCase().includes(kLower)) {
                            // console.log(`      ⏭️ Skipped (Keyword mismatch): ${title}`);
                            continue;
                        }

                        // Truncate description for output/log as requested
                        job.description = job.description.slice(0, 100) + '...';

                        jobs.push(job);
                        console.log(`      ✅ ${job.title} - ${job.company}`);

                    } catch (e) {
                        // console.warn('      Failed to process a card:', e.message);
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
