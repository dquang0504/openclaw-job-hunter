/**
 * OpenClaw Job Search Automation
 * Main orchestration file
 * 
 * Flow:
 * 1. Scrape active platforms (Twitter, Facebook, Threads, Indeed, TopDev, ITViec, Vercel, Cloudflare)
 * 2. Collect ALL raw jobs
 * 3. ONE batch AI validation call for all jobs (Groq or regex fallback)
 * 4. Filter, deduplicate, and send to Telegram
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

// Import modules
const CONFIG = require('./config');
const TelegramReporter = require('./lib/telegram');
const { formatDateTime } = require('./utils/date');
const { createBrowserSession, ensureRuntimeDirectories } = require('./openclaw/browser');
const { createHealthTracker } = require('./openclaw/health');
const { createRunPolicy } = require('./openclaw/policies');
const { createRunState } = require('./openclaw/state');
const { runOpenClaw } = require('./openclaw/runner');
const { createRunTelemetry } = require('./openclaw/telemetry');

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function main() {
    const runPolicy = createRunPolicy(process.argv.slice(2));

    console.log(`🚀 Starting job search (dry-run: ${runPolicy.isDryRun}, platform: ${runPolicy.platformParam}, AI: ${!runPolicy.skipAI})`);
    console.log(`🕒 Execution started at: ${formatDateTime()}`);

    ensureRuntimeDirectories();

    const reporter = new TelegramReporter();
    const runState = createRunState();
    const telemetry = createRunTelemetry(runPolicy);
    const healthTracker = createHealthTracker();
    const { browser, context, page, userAgent } = await createBrowserSession();
    console.log(`🕵️ Using User-Agent: ${userAgent}`);
    let allRawJobs = [];

    try {
        const runResult = await runOpenClaw({
            context,
            page,
            reporter,
            runPolicy,
            runState,
            telemetry,
            healthTracker
        });
        allRawJobs = runResult.allRawJobs;

        if (runResult.hadNoUnseenJobs) {
            const datedLogFile = path.join(CONFIG.paths.logs, `job-search-${new Date().toISOString().split('T')[0]}.json`);
            if (!fs.existsSync(CONFIG.paths.logs)) {
                fs.mkdirSync(CONFIG.paths.logs, { recursive: true });
            }
            fs.writeFileSync(datedLogFile, JSON.stringify(allRawJobs, null, 2));
        }
    } catch (error) {
        console.error('Fatal error:', error);
        await reporter.sendError(error.message);
    } finally {
        runState.persistSeenEntries(runPolicy.isDryRun);

        // Save results BEFORE closing browser to avoid "Page/browser was closed" error
        const safeTime = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        const logFile = path.join(CONFIG.paths.logs, `job-search-${safeTime}.json`);

        if (!fs.existsSync(CONFIG.paths.logs)) {
            fs.mkdirSync(CONFIG.paths.logs, { recursive: true });
        }
        fs.writeFileSync(logFile, JSON.stringify(allRawJobs, null, 2));
        console.log(`\n📁 Results saved to ${logFile}`);

        const telemetryLogFile = path.join(CONFIG.paths.logs, `openclaw-run-${safeTime}.json`);
        fs.writeFileSync(telemetryLogFile, JSON.stringify(telemetry.buildRunSummary(), null, 2));
        console.log(`📁 OpenClaw telemetry saved to ${telemetryLogFile}`);

        await browser.close();
    }
}

main().catch(console.error);
