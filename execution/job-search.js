/**
 * OpenClaw Job Search Automation
 * Main orchestration file
 * 
 * Flow:
 * 1. Scrape all platforms (TopCV, Twitter, LinkedIn)
 * 2. Collect ALL raw jobs
 * 3. ONE batch AI validation call for all jobs (G4F)
 * 4. Filter, deduplicate, and send to Telegram
 */

require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Import modules
const CONFIG = require('./config');
const TelegramReporter = require('./lib/telegram');
const { loadSeenJobs, saveSeenJobs } = require('./lib/deduplication');
const { randomDelay, getRandomUserAgent, applyStealthSettings } = require('./lib/stealth');
const { batchValidateJobsWithAI } = require('./lib/ai-filter');
const { calculateMatchScore } = require('./lib/filters');

// Import scrapers
const { scrapeTopCV } = require('./scrapers/topcv');
const { scrapeTwitter } = require('./scrapers/twitter');
const { scrapeLinkedIn, createLinkedInContext } = require('./scrapers/linkedin');

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function main() {
    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run');
    const platformArg = args.find(a => a.startsWith('--platform='));
    const platform = platformArg ? platformArg.split('=')[1] : 'all';
    const skipAI = args.includes('--no-ai');

    console.log(`🚀 Starting job search (dry-run: ${isDryRun}, platform: ${platform}, AI: ${!skipAI})`);

    // Ensure directories exist
    for (const dir of Object.values(CONFIG.paths)) {
        const dirPath = path.dirname(dir);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    const reporter = new TelegramReporter();

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Regular context for TopCV and Twitter
    const context = await browser.newContext({
        userAgent: getRandomUserAgent(),
        viewport: { width: 1366, height: 768 },
        locale: 'vi-VN'
    });

    // Load cookies
    const cookieFiles = {
        topcv: path.join(CONFIG.paths.cookies, 'cookies-topcv.json'),
        twitter: path.join(CONFIG.paths.cookies, 'cookies-twitter.json'),
        linkedin: path.join(CONFIG.paths.cookies, 'cookies-linkedin.json')  // NEW: LinkedIn cookies
    };

    for (const [name, file] of Object.entries(cookieFiles)) {
        if (fs.existsSync(file)) {
            try {
                const cookies = JSON.parse(fs.readFileSync(file, 'utf-8'));
                await context.addCookies(cookies);
                console.log(`🍪 Loaded ${name} cookies`);
            } catch (e) {
                console.warn(`⚠️ Failed to load ${name} cookies:`, e.message);
            }
        }
    }

    const page = await context.newPage();
    let allRawJobs = [];  // Raw jobs before AI validation

    try {
        // =====================================================================
        // STEP 1: SCRAPE ALL PLATFORMS (collect raw jobs)
        // =====================================================================

        // Scrape TopCV
        if (platform === 'all' || platform === 'topcv') {
            const topcvJobs = await scrapeTopCV(page, reporter);
            allRawJobs = allRawJobs.concat(topcvJobs.map((j, i) => ({ ...j, id: `topcv-${i}` })));
        }

        // Scrape Twitter
        if (platform === 'all' || platform === 'twitter') {
            const twitterJobs = await scrapeTwitter(page, reporter);
            allRawJobs = allRawJobs.concat(twitterJobs.map((j, i) => ({ ...j, id: `twitter-${i}` })));
        }

        // Scrape LinkedIn
        if (platform === 'all' || platform === 'linkedin') {
            console.log('\n🔒 Starting LinkedIn scraper...');

            // Check if LinkedIn cookies exist for authenticated mode
            const hasLinkedInCookies = fs.existsSync(cookieFiles.linkedin);

            // Always create separate context for LinkedIn
            const linkedInContext = await createLinkedInContext(browser);
            const linkedInPage = await linkedInContext.newPage();

            try {
                // Load cookies if available
                if (hasLinkedInCookies) {
                    console.log('  🍪 Using LinkedIn cookies (authenticated mode)');
                    const cookies = JSON.parse(fs.readFileSync(cookieFiles.linkedin, 'utf-8'));
                    await linkedInContext.addCookies(cookies);
                } else {
                    console.log('  🔓 No LinkedIn cookies - using Guest Mode');
                }

                await applyStealthSettings(linkedInPage);

                const linkedInJobs = await scrapeLinkedIn(linkedInPage, reporter);
                allRawJobs = allRawJobs.concat(linkedInJobs.map((j, i) => ({ ...j, id: `linkedin-${i}` })));
            } catch (error) {
                console.error('  ❌ LinkedIn scraper error:', error.message);
            } finally {
                await linkedInContext.close();
                console.log('  🧹 LinkedIn context closed');
            }
        }

        console.log(`\n📦 Total raw jobs collected: ${allRawJobs.length}`);

        // =====================================================================
        // STEP 2: DEDUPLICATION (Filter BEFORE AI to save tokens)
        // =====================================================================

        const seenJobs = loadSeenJobs();
        // Filter out jobs already seen
        let unseenJobs = allRawJobs.filter(job => !seenJobs.has(job.url));

        console.log(`\n🔍 Deduplication: ${allRawJobs.length} total -> ${unseenJobs.length} unseen jobs`);

        if (unseenJobs.length === 0) {
            console.log('ℹ️ No new unseen jobs to process.');
            // Save logs even if no new jobs
            const logFile = path.join(CONFIG.paths.logs, `job-search-${new Date().toISOString().split('T')[0]}.json`);
            if (!fs.existsSync(CONFIG.paths.logs)) fs.mkdirSync(CONFIG.paths.logs, { recursive: true });
            fs.writeFileSync(logFile, JSON.stringify(allRawJobs, null, 2));
            return;
        }

        // =====================================================================
        // STEP 3: UNIFIED AI VALIDATION (Only for UNSEEN jobs)
        // =====================================================================

        let validatedNewJobs = unseenJobs;

        if (!skipAI) {
            const aiResults = await batchValidateJobsWithAI(unseenJobs);

            // Apply AI scores to jobs
            validatedNewJobs = unseenJobs.map(job => {
                const result = aiResults.get(job.id);
                if (result) {
                    return {
                        ...job,
                        matchScore: result.score,
                        aiReason: result.reason,
                        aiValidated: result.isValid,
                        // Override fields if AI provided them and they are better than default
                        location: (result.location && result.location !== 'Unknown') ? result.location : job.location,
                        postedDate: (result.postedDate && result.postedDate !== 'Unknown') ? result.postedDate : job.postedDate,
                        techStack: result.techStack || job.techStack
                    };
                }
                return { ...job, matchScore: calculateMatchScore(job), aiValidated: true };
            });

            // Filter only valid jobs
            validatedNewJobs = validatedNewJobs.filter(job => job.aiValidated && job.matchScore >= 5);
        }

        // Sort by match score
        validatedNewJobs.sort((a, b) => b.matchScore - a.matchScore);

        // =====================================================================
        // STEP 4: SEND TO TELEGRAM
        // =====================================================================

        console.log(`\n📊 Found ${validatedNewJobs.length} valid NEW jobs to send`);

        if (validatedNewJobs.length === 0) {
            console.log('ℹ️ No valid new jobs found after AI validation');
        } else {
            const jobsToSend = validatedNewJobs.slice(0, 5);
            const sentUrls = [];

            for (const job of jobsToSend) {
                console.log(`  [${job.matchScore}/10] ${job.title?.slice(0, 50)} @ ${job.company}`);

                if (!isDryRun) {
                    await reporter.sendJobReport(job);
                    await randomDelay(500, 1000);
                }
                sentUrls.push(job.url);
            }

            if (!isDryRun && sentUrls.length > 0) {
                saveSeenJobs(sentUrls);
            }

            await reporter.sendStatus(`✅ Tìm được ${validatedNewJobs.length} jobs mới valid, đã gửi ${jobsToSend.length} jobs.`);
        }

    } catch (error) {
        console.error('Fatal error:', error);
        await reporter.sendError(error.message);
    } finally {
        await browser.close();
    }

    // Save results
    const logFile = path.join(CONFIG.paths.logs, `job-search-${new Date().toISOString().split('T')[0]}.json`);
    if (!fs.existsSync(CONFIG.paths.logs)) {
        fs.mkdirSync(CONFIG.paths.logs, { recursive: true });
    }
    fs.writeFileSync(logFile, JSON.stringify(allRawJobs, null, 2));
    console.log(`\n📁 Results saved to ${logFile}`);
}

main().catch(console.error);
