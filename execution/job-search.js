/**
 * OpenClaw Job Search Automation
 * Main orchestration file
 * 
 * Flow:
 * 1. Scrape all platforms (TopCV, Twitter, LinkedIn, Facebook, Threads, Indeed)
 * 2. Collect ALL raw jobs
 * 3. ONE batch AI validation call for all jobs (G4F)
 * 4. Filter, deduplicate, and send to Telegram
 */

require('dotenv').config();
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const fs = require('fs');
const path = require('path');

// Import modules
const CONFIG = require('./config');
const TelegramReporter = require('./lib/telegram');
const { loadSeenJobs, saveSeenJobs } = require('./lib/deduplication');
const { randomDelay, getRandomUserAgent, applyStealthSettings } = require('./lib/stealth');
const { batchValidateJobsWithAI } = require('./lib/ai-filter');
const { calculateMatchScore } = require('./lib/filters');
const { formatDateTime } = require('./utils/date');

// Import scrapers
//const { scrapeTopCV } = require('./scrapers/topcv');
const { scrapeTwitter } = require('./scrapers/twitter');
const { scrapeLinkedIn, createLinkedInContext } = require('./scrapers/linkedin');
const { scrapeFacebook } = require('./scrapers/facebook');
const { scrapeThreads } = require('./scrapers/threads');
const { scrapeIndeed } = require('./scrapers/indeed');
const { scrapeVercel } = require('./scrapers/vercel');
const { scrapeCloudflare } = require('./scrapers/cloudflare');
const { scrapeTopDev } = require('./scrapers/topdev');
const { scrapeITViec } = require('./scrapers/itviec');

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function main() {
    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run');
    const platformArg = args.find(a => a.startsWith('--platform='));
    const platformParam = platformArg ? platformArg.split('=')[1] : 'all';
    const platforms = platformParam.split(',');
    const shouldRun = (p) => platforms.includes('all') || platforms.includes(p);
    const skipAI = args.includes('--no-ai');

    console.log(`🚀 Starting job search (dry-run: ${isDryRun}, platform: ${platformParam}, AI: ${!skipAI})`);
    console.log(`🕒 Execution started at: ${formatDateTime()}`);

    // Ensure directories exist
    for (const dir of Object.values(CONFIG.paths)) {
        const dirPath = path.dirname(dir);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    const reporter = new TelegramReporter();

    // Use headless: false for topdev, topcv, itviec (they need UI for filters)
    // xvfb-run in GitHub Actions provides virtual display
    // Use headless: false for topdev, topcv, itviec (they need UI for filters)
    // xvfb-run in GitHub Actions provides virtual display
    const needsHeadful = shouldRun('topdev') || shouldRun('itviec');
    // NOTE: TopCV has been switched to headless: true for testing as requested

    const browser = await chromium.launch({
        headless: false,
        timeout: 60000,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--window-size=1280,800',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-first-run',
            '--no-service-autorun',
            '--password-store=basic'
        ]
    });

    // Regular context for TopCV and Twitter
    // Using Desktop User Agent (matches debug-browser.js success)
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
    console.log(`🕵️ Using User-Agent: ${userAgent}`);

    const contextOptions = {
        userAgent: userAgent,
        viewport: { width: 1280, height: 800 },
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh',
        // Minimal headers like debug-browser.js
        // permissions: ['geolocation'],
        // geolocation: { latitude: 10.7769, longitude: 106.7009 }, // HCM
        javaScriptEnabled: true,
        /* 
        extraHTTPHeaders: {
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"'
        } 
        */
    };

    // Proxy Configuration (Placeholder for future use)
    if (process.env.PROXY_SERVER) {
        contextOptions.proxy = {
            server: process.env.PROXY_SERVER,
            // username: process.env.PROXY_USERNAME,
            // password: process.env.PROXY_PASSWORD
        };
        console.log(`🌐 Using Proxy: ${process.env.PROXY_SERVER}`);
    }

    const context = await browser.newContext(contextOptions);

    // Load cookies
    const cookieFiles = {
        topcv: path.join(CONFIG.paths.cookies, 'cookies-topcv.json'),
        twitter: path.join(CONFIG.paths.cookies, 'cookies-twitter.json'),
        linkedin: path.join(CONFIG.paths.cookies, 'cookies-linkedin.json'),
        facebook: path.join(CONFIG.paths.cookies, 'cookies-facebook.json'),
        threads: path.join(CONFIG.paths.cookies, 'cookies-threads.json'),
        vercel: path.join(CONFIG.paths.cookies, 'cookies-vercel.json'),
        topdev: path.join(CONFIG.paths.cookies, 'cookies-topdev.json'),
        itviec: path.join(CONFIG.paths.cookies, 'cookies-itviec.json')
    };

    for (const [name, file] of Object.entries(cookieFiles)) {
        if (fs.existsSync(file)) {
            try {
                const cookieData = JSON.parse(fs.readFileSync(file, 'utf-8'));
                // Support both direct array and object with 'cookies' property (like EditThisCookie export)
                const cookies = Array.isArray(cookieData) ? cookieData : (cookieData.cookies || []);

                if (cookies.length > 0) {
                    // Sanitize cookies for Playwright (Fix sameSite: no_restriction)
                    const cleanCookies = cookies.map(c => {
                        if (c.sameSite === 'no_restriction' || c.sameSite === 'unspecified') {
                            c.sameSite = 'None';
                        }
                        // Ensure valid values: Strict, Lax, None
                        if (!['Strict', 'Lax', 'None'].includes(c.sameSite)) {
                            delete c.sameSite; // Let browser default
                        }
                        return c;
                    });

                    await context.addCookies(cleanCookies);
                    console.log(`🍪 Loaded ${name} cookies (${cleanCookies.length})`);
                }
            } catch (e) {
                console.warn(`⚠️ Failed to load ${name} cookies:`, e.message);
            }
        }
    }

    const page = await context.newPage();
    const seenJobs = loadSeenJobs(); // Pre-load seen jobs for optimization
    let allRawJobs = [];  // Raw jobs before AI validation

    try {
        // =====================================================================
        // STEP 1: SCRAPE ALL PLATFORMS (collect raw jobs)
        // =====================================================================

        // Scrape TopCV
        //if (shouldRun('topcv')) {
        //    const topcvJobs = await scrapeTopCV(page, reporter);
        //    allRawJobs = allRawJobs.concat(topcvJobs.map((j, i) => ({ ...j, id: `topcv-${i}` })));
        //}

        // Scrape Twitter
        if (shouldRun('twitter')) {
            const twitterJobs = await scrapeTwitter(page, reporter);
            allRawJobs = allRawJobs.concat(twitterJobs.map((j, i) => ({ ...j, id: `twitter-${i}` })));
        }

        // Scrape LinkedIn
        // Scrape LinkedIn
        // if (shouldRun('linkedin')) {
        //     const linkedinJobs = await scrapeLinkedIn(page, reporter);
        //     allRawJobs = allRawJobs.concat(linkedinJobs.map((j, i) => ({ ...j, id: `linkedin-${i}` })));
        // }

        // Scrape Facebook
        if (shouldRun('facebook')) {
            const fbJobs = await scrapeFacebook(page, reporter, seenJobs);
            allRawJobs = allRawJobs.concat(fbJobs.map((j, i) => ({ ...j, id: `facebook-${i}` })));
        }

        // Scrape Threads
        if (shouldRun('threads')) {
            const threadsJobs = await scrapeThreads(page, reporter);
            allRawJobs = allRawJobs.concat(threadsJobs.map((j, i) => ({ ...j, id: `threads-${i}` })));
        }

        // Scrape Indeed
        if (shouldRun('indeed')) {
            const indeedJobs = await scrapeIndeed(page, reporter);
            allRawJobs = allRawJobs.concat(indeedJobs.map((j, i) => ({ ...j, id: `indeed-${i}` })));
        }

        // Scrape TopDev
        if (shouldRun('topdev')) {
            const topdevJobs = await scrapeTopDev(page, reporter);
            allRawJobs = allRawJobs.concat(topdevJobs.map((j, i) => ({ ...j, id: `topdev-${i}` })));
        }

        // Scrape ITViec
        if (shouldRun('itviec')) {
            const itviecJobs = await scrapeITViec(page, reporter);
            allRawJobs = allRawJobs.concat(itviecJobs.map((j, i) => ({ ...j, id: `itviec-${i}` })));
        }

        // Monitor Vercel
        if (shouldRun('vercel')) {
            try {
                console.log('⏳ Starting Vercel scrape with 1m timeout...');
                await Promise.race([
                    scrapeVercel(page, reporter),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Vercel scrape timed out (1m)')), 60000))
                ]);
            } catch (e) {
                console.error(`  ⚠️ Vercel scrape skipped due to timeout/error: ${e.message}`);
            }
        }

        // Monitor Cloudflare
        if (shouldRun('cloudflare')) {
            try {
                console.log('⏳ Starting Cloudflare check with 30s timeout...');
                await Promise.race([
                    scrapeCloudflare(reporter),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Cloudflare timed out (30s)')), 30000))
                ]);
            } catch (e) {
                console.error(`  ⚠️ Cloudflare check skipped: ${e.message}`);
            }
        }

        console.log(`\n📦 Total raw jobs collected: ${allRawJobs.length}`);

        // =====================================================================
        // STEP 1.5: PRE-FILTERING (Strict Date & Experience)
        // =====================================================================
        const { shouldIncludeJob } = require('./lib/filters');

        const initialCount = allRawJobs.length;
        allRawJobs = allRawJobs.filter(job => {
            const shouldInclude = shouldIncludeJob(job);
            if (!shouldInclude) {
                // console.log(`  Filtered out: ${job.title} (${job.postedDate})`);
            }
            return shouldInclude;
        });
        console.log(`\n🧹 Pre-filtering: ${initialCount} -> ${allRawJobs.length} jobs (removed old/irrelevant)`);

        // =====================================================================
        // STEP 2: DEDUPLICATION (Filter BEFORE AI to save tokens)
        // =====================================================================

        // const seenJobs = loadSeenJobs(); // Moved to start of execution
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
            // Send up to 8 jobs (increased to 8 for buffer strategy)
            const jobsToSend = validatedNewJobs.slice(0, 8);
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
        // Save results BEFORE closing browser to avoid "Page/browser was closed" error
        const safeTime = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        const logFile = path.join(CONFIG.paths.logs, `job-search-${safeTime}.json`);

        if (!fs.existsSync(CONFIG.paths.logs)) {
            fs.mkdirSync(CONFIG.paths.logs, { recursive: true });
        }
        fs.writeFileSync(logFile, JSON.stringify(allRawJobs, null, 2));
        console.log(`\n📁 Results saved to ${logFile}`);

        await browser.close();
    }
}

main().catch(console.error);
