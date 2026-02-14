/**
 * TopCV.vn Scraper
 */

const path = require('path');
const CONFIG = require('../config');
const { calculateMatchScore } = require('../lib/filters');

/**
 * Helper: Normalize text to handle fancy fonts and accents
 */
const normalizeText = (text) => (text || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Scrape jobs from TopCV.vn
 * @param {import('playwright').Page} page 
 * @param {import('../lib/telegram')} reporter 
 */
async function scrapeTopCV(page, reporter) {
    console.log('📋 Searching TopCV.vn...');

    const jobs = [];

    console.log(`  🔍 Searching with ${CONFIG.keywords.length} keywords...`);

    const experienceLevels = [1, 2, 3]; // 1: No Exp, 2: <1 Year, 3: 1 Year

    for (const keyword of CONFIG.keywords) {
        for (const exp of experienceLevels) {
            try {
                // Slugify keyword: "golang" -> "golang"
                const slug = keyword.toLowerCase().split(/\s+/).join('-');

                // Specific URL for Can Tho (l20) AND Ho Chi Minh (l2)
                // &locations=l2_l20 means both
                const searchUrl = `https://www.topcv.vn/tim-viec-lam-${slug}-tai-ho-chi-minh-kl2?exp=${exp}&sort=new&type_keyword=1&sba=1&locations=l2_l20&saturday_status=0`;
                console.log(`  🔍 Searching: ${keyword} (Exp: ${exp}) - Cần Thơ & HCM`);

                // Reduced timeout and no random delay
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });

                // ANTI-BOT: Check for Cloudflare challenge (same as TopDev)
                const pageTitle = await page.title();
                if (pageTitle.includes('Attention Required') || pageTitle.includes('Just a moment') || pageTitle.includes('Cloudflare')) {
                    console.log('    🛡️ Cloudflare challenge detected. Waiting...');
                    // Wait for challenge to complete (usually 5-10 seconds)
                    await page.waitForTimeout(8000);

                    // Check if still on challenge page
                    const stillChallenged = await page.title().then(t => t.includes('Attention Required') || t.includes('Cloudflare'));
                    if (stillChallenged) {
                        console.log('    ⚠️ Cloudflare challenge still active. Waiting longer...');
                        await page.waitForTimeout(7000);

                        // Final check
                        const finalCheck = await page.title().then(t => t.includes('Attention Required') || t.includes('Cloudflare'));
                        if (finalCheck) {
                            console.log('    ❌ Cloudflare challenge failed. Skipping...');
                            continue;
                        }
                    }
                }

                // Check for CAPTCHA
                if (await page.locator('.captcha, .recaptcha, [data-captcha]').count() > 0) {
                    console.log('⚠️ CAPTCHA detected...');
                    continue;
                }

                // Fast scroll to trigger lazy load
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                // Removed explicit wait as requested

                // Check if "No suitable job" message is visible (User confirmed logic)
                if (await page.locator('.none-suitable-job').isVisible()) {
                    console.log(`    ⚠️ No suitable jobs found (strict match)`);
                    continue;
                }

                // DEBUG: Check page title and URL to verify we're on the right page
                const currentUrl = page.url();
                console.log(`    🔍 DEBUG: Page title: ${await page.title()}`);
                console.log(`    🔍 DEBUG: Current URL: ${currentUrl}`);

                // Strict selector: Only pick up direct search results, NOT suggested jobs
                const jobCards = await page.locator('.job-item-search-result').all();
                console.log(`    📦 Found ${jobCards.length} job cards`);

                // DEBUG: If no cards found, try alternative selectors
                if (jobCards.length === 0) {
                    const altCards1 = await page.locator('.job-item').all();
                    const altCards2 = await page.locator('[class*="job-item"]').all();
                    console.log(`    🔍 DEBUG: Alternative selector '.job-item': ${altCards1.length} cards`);
                    console.log(`    🔍 DEBUG: Alternative selector '[class*="job-item"]': ${altCards2.length} cards`);
                }

                // Process only top 20 for speed
                for (const card of jobCards.slice(0, 20)) {
                    try {
                        const titleEl = card.locator('h3.title a, .title-block a, a.title').first();
                        // Fail fast (100ms) if element not found to avoid blocking
                        const title = await titleEl.textContent({ timeout: 100 }).catch(() => null);
                        const urlVal = await titleEl.getAttribute('href', { timeout: 100 }).catch(() => null);

                        // Improved Company Selector: target the span or link text directly
                        const company = await card.locator('.company-name, .company-name a, .company a, .employer-name').first().textContent({ timeout: 100 }).catch(() => 'Unknown');
                        const location = await card.locator('.address, .location, .label-address').first().textContent({ timeout: 100 }).catch(() => 'Vietnam');
                        const salary = await card.locator('.title-salary, .salary').first().textContent({ timeout: 100 }).catch(() => 'Negotiable');

                        if (!title) continue;

                        const job = {
                            title: title.trim(),
                            company: company.trim(),
                            url: urlVal?.startsWith('http') ? urlVal : `https://www.topcv.vn${urlVal}`,
                            salary: salary?.trim() || 'Negotiable',
                            location: location?.trim(),
                            source: 'TopCV.vn',
                            techStack: 'Golang'
                        };

                        // Use Normalized text for checks
                        const jobTextNorm = normalizeText(`${job.title} ${job.company}`);
                        // const locLower = normalizeText(job.location); // Not strict filtering location since we search for specific locs

                        // 1. Strict Keyword Check
                        if (!jobTextNorm.includes('go') && !jobTextNorm.includes('golang')) continue;

                        // 2. Strict Exclude (Experience)
                        if (CONFIG.excludeRegex.test(jobTextNorm)) continue;

                        // 3. Strict Location (Remote or Can Tho or HCM)
                        // Since we search via URL parameters (l2_l20), the results should be valid.
                        // We relax the strict block on "Hanoi/HCM" since HCM is now allowed.
                        /*
                        const isTarget = locLower.includes('remote') || locLower.includes('tu xa') || locLower.includes('can tho');
                        const isHanoiHCM = locLower.includes('ha noi') || locLower.includes('ho chi minh') || locLower.includes('hcm') || locLower.includes('saigon');
                        if (!isTarget && isHanoiHCM) continue; 
                        */

                        job.matchScore = calculateMatchScore(job);
                        jobs.push(job);
                        console.log(`      ✅ ${job.title} - ${job.location}`);

                    } catch (e) {
                        // Skip malformed
                    }
                }
            } catch (error) {
                console.error(`Error searching "${keyword}":`, error.message);
            }
        }
    }

    // Remove duplicates by URL
    const uniqueJobs = [...new Map(jobs.map(j => [j.url, j])).values()];
    return uniqueJobs;
}

module.exports = { scrapeTopCV };
