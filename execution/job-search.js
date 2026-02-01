/**
 * OpenClaw Job Search Automation
 * Main orchestration file - imports all modules
 * 
 * Platforms:
 * - TopCV.vn (with cookies)
 * - X/Twitter (with cookies)
 * - LinkedIn (Guest Mode - no cookies/login required)
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

    console.log(`🚀 Starting job search (dry-run: ${isDryRun}, platform: ${platform})`);

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

    // Regular context for TopCV and Twitter (with cookies)
    const context = await browser.newContext({
        userAgent: getRandomUserAgent(),
        viewport: { width: 1366, height: 768 },
        locale: 'vi-VN'
    });

    // Load cookies for TopCV and Twitter
    const cookieFiles = {
        topcv: path.join(CONFIG.paths.cookies, 'cookies-topcv.json'),
        twitter: path.join(CONFIG.paths.cookies, 'cookies-twitter.json')
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
    let allJobs = [];

    try {
        // Scrape TopCV
        if (platform === 'all' || platform === 'topcv') {
            const topcvJobs = await scrapeTopCV(page, reporter);
            allJobs = allJobs.concat(topcvJobs);
        }

        // Scrape Twitter
        if (platform === 'all' || platform === 'twitter') {
            const twitterJobs = await scrapeTwitter(page, reporter);
            allJobs = allJobs.concat(twitterJobs);
        }

        // Scrape LinkedIn (Guest Mode - separate context, no cookies)
        if (platform === 'all' || platform === 'linkedin') {
            console.log('\n🔒 Starting LinkedIn Guest Mode (no login/cookies)...');

            // Create fresh context for LinkedIn - no persistence
            const linkedInContext = await createLinkedInContext(browser);
            const linkedInPage = await linkedInContext.newPage();

            // Apply stealth settings
            await applyStealthSettings(linkedInPage);

            try {
                const linkedInJobs = await scrapeLinkedIn(linkedInPage, reporter);
                allJobs = allJobs.concat(linkedInJobs);
            } finally {
                // Clear all session data - ensures fresh guest identity next run
                await linkedInContext.clearCookies();
                await linkedInContext.close();
                console.log('  🧹 LinkedIn context cleared (fresh guest identity)');
            }
        }

        // Sort by match score
        allJobs.sort((a, b) => b.matchScore - a.matchScore);

        // Deduplication
        const seenJobs = loadSeenJobs();
        const newJobs = allJobs.filter(job => !seenJobs.has(job.url));
        console.log(`\n📊 Found ${allJobs.length} jobs total, ${newJobs.length} are NEW`);

        if (newJobs.length === 0) {
            console.log('ℹ️ No new jobs found - all have been seen before');
        } else {
            // Report top 5 NEW jobs only
            const jobsToSend = newJobs.slice(0, 5);
            const sentUrls = [];

            for (const job of jobsToSend) {
                console.log(`  [${job.matchScore}/10] ${job.title} @ ${job.company}`);

                if (!isDryRun) {
                    await reporter.sendJobReport(job);
                    await randomDelay(500, 1000);
                }
                sentUrls.push(job.url);
            }

            // Save newly sent jobs
            if (!isDryRun && sentUrls.length > 0) {
                saveSeenJobs(sentUrls);
            }

            await reporter.sendStatus(`✅ Tìm được ${allJobs.length} jobs (${newJobs.length} mới), đã gửi ${jobsToSend.length} jobs mới.`);
        }

    } catch (error) {
        console.error('Fatal error:', error);
        await reporter.sendError(error.message);
    } finally {
        await browser.close();
    }

    // Save results to log
    const logFile = path.join(CONFIG.paths.logs, `job-search-${new Date().toISOString().split('T')[0]}.json`);
    if (!fs.existsSync(CONFIG.paths.logs)) {
        fs.mkdirSync(CONFIG.paths.logs, { recursive: true });
    }
    fs.writeFileSync(logFile, JSON.stringify(allJobs, null, 2));
    console.log(`\n📁 Results saved to ${logFile}`);
}

main().catch(console.error);
