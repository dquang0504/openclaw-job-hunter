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

            if (hasLinkedInCookies) {
                console.log('  🍪 Using LinkedIn cookies (authenticated mode)');
                // Use main context with LinkedIn cookies
                const linkedInJobs = await scrapeLinkedIn(page, reporter);
                allRawJobs = allRawJobs.concat(linkedInJobs.map((j, i) => ({ ...j, id: `linkedin-${i}` })));
            } else {
                console.log('  🔓 No LinkedIn cookies - using Guest Mode');
                // Create fresh context for Guest Mode
                const linkedInContext = await createLinkedInContext(browser);
                const linkedInPage = await linkedInContext.newPage();
                await applyStealthSettings(linkedInPage);

                try {
                    const linkedInJobs = await scrapeLinkedIn(linkedInPage, reporter);
                    allRawJobs = allRawJobs.concat(linkedInJobs.map((j, i) => ({ ...j, id: `linkedin-${i}` })));
                } finally {
                    await linkedInContext.clearCookies();
                    await linkedInContext.close();
                    console.log('  🧹 LinkedIn guest context cleared');
                }
            }
        }

        console.log(`\n📦 Total raw jobs collected: ${allRawJobs.length}`);

        // =====================================================================
        // STEP 2: UNIFIED AI VALIDATION (ONE batch call for ALL jobs)
        // =====================================================================

        let validatedJobs = allRawJobs;

        if (!skipAI && allRawJobs.length > 0) {
            const aiResults = await batchValidateJobsWithAI(allRawJobs);

            // Apply AI scores to jobs
            validatedJobs = allRawJobs.map(job => {
                const result = aiResults.get(job.id);
                if (result) {
                    return {
                        ...job,
                        matchScore: result.score,
                        aiReason: result.reason,
                        aiValidated: result.isValid
                    };
                }
                return { ...job, matchScore: calculateMatchScore(job), aiValidated: true };
            });

            // Filter only valid jobs
            validatedJobs = validatedJobs.filter(job => job.aiValidated && job.matchScore >= 5);
        }

        // Sort by match score
        validatedJobs.sort((a, b) => b.matchScore - a.matchScore);

        // =====================================================================
        // STEP 3: DEDUPLICATION & SEND TO TELEGRAM
        // =====================================================================

        const seenJobs = loadSeenJobs();
        const newJobs = validatedJobs.filter(job => !seenJobs.has(job.url));
        console.log(`\n📊 Found ${validatedJobs.length} valid jobs, ${newJobs.length} are NEW`);

        if (newJobs.length === 0) {
            console.log('ℹ️ No new jobs found - all have been seen before');
        } else {
            const jobsToSend = newJobs.slice(0, 5);
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

            await reporter.sendStatus(`✅ Tìm được ${validatedJobs.length} jobs (${newJobs.length} mới), đã gửi ${jobsToSend.length} jobs mới.`);
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
