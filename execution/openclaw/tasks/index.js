const { scrapeTwitter } = require('../../scrapers/twitter');
const { scrapeThreads } = require('../../scrapers/threads');
const { scrapeIndeed } = require('../../scrapers/indeed');
const { scrapeVercel } = require('../../scrapers/vercel');
const { scrapeCloudflare } = require('../../scrapers/cloudflare');
const { scrapeTopDev } = require('../../scrapers/topdev');
const { scrapeITViec } = require('../../scrapers/itviec');
const ScreenshotDebugger = require('../../lib/screenshot');
const { runFacebookTask } = require('./facebook-search');

function appendTaggedJobs(jobs, platform) {
    return (jobs || []).map((job, index) => ({ ...job, id: `${platform}-${index}` }));
}

function createTaskResult({
    platform,
    status,
    rawJobs = [],
    staleUrls = [],
    warnings = [],
    error = null,
    metrics = {},
    startedAt
}) {
    return {
        platform,
        status,
        rawJobs,
        staleUrls,
        warnings,
        error,
        durationMs: Date.now() - startedAt,
        metrics: {
            rawJobCount: rawJobs.length,
            staleCount: staleUrls.length,
            scannedCount: rawJobs.length,
            ...metrics
        }
    };
}

async function withTimeout(work, timeoutMs, timeoutMessage) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            const timeoutError = new Error(timeoutMessage);
            timeoutError.code = 'TASK_TIMEOUT';
            reject(timeoutError);
        }, timeoutMs);

        Promise.resolve()
            .then(work)
            .then(result => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch(error => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

function normalizeScrapeResult(platform, rawResult) {
    if (platform === 'facebook') {
        return {
            status: rawResult?.status || 'success',
            rawJobs: appendTaggedJobs(rawResult?.jobs || [], platform),
            staleUrls: rawResult?.staleUrls || [],
            warnings: rawResult?.warnings || [],
            error: rawResult?.error || null,
            metrics: rawResult?.metrics || {}
        };
    }

    if (Array.isArray(rawResult)) {
        return {
            status: 'success',
            rawJobs: appendTaggedJobs(rawResult, platform),
            staleUrls: [],
            warnings: [],
            error: null,
            metrics: {
                scannedCount: rawResult.length
            }
        };
    }

    return {
        status: rawResult?.status || 'success',
        rawJobs: appendTaggedJobs(rawResult?.jobs || [], platform),
        staleUrls: rawResult?.staleUrls || [],
        warnings: rawResult?.warnings || [],
        error: rawResult?.error || null,
        metrics: rawResult?.metrics || {}
    };
}

function getTaskDefinitions() {
    return {
        twitter: {
            run: ({ page, reporter }) => scrapeTwitter(page, reporter)
        },
        facebook: {
            run: ({ page, reporter, runState, runPolicy }) => runFacebookTask({ page, reporter, runState, runPolicy })
        },
        threads: {
            run: ({ page, reporter }) => scrapeThreads(page, reporter)
        },
        indeed: {
            run: ({ page, reporter }) => scrapeIndeed(page, reporter)
        },
        topdev: {
            run: ({ page, reporter }) => scrapeTopDev(page, reporter)
        },
        itviec: {
            run: ({ page, reporter }) => scrapeITViec(page, reporter)
        },
        vercel: {
            run: ({ page, reporter }) => scrapeVercel(page, reporter)
        },
        cloudflare: {
            run: async ({ reporter }) => {
                await scrapeCloudflare(reporter);
                return [];
            }
        }
    };
}

function looksLikeAuthIssue(error) {
    const message = error?.message?.toLowerCase() || '';
    return [
        'login',
        'checkpoint',
        'session expired',
        'not logged in',
        'auth',
        'cookie'
    ].some(token => message.includes(token));
}

async function captureTaskFailure(platform, taskContext, error) {
    if (!taskContext.page) return;

    const screenshotDebugger = new ScreenshotDebugger(taskContext.reporter);
    const authIssue = looksLikeAuthIssue(error);

    if (authIssue) {
        await screenshotDebugger.captureAuthIssue(taskContext.page, platform, error.message);
        await taskContext.reporter.sendStatus(`⚠️ ${platform} skipped due to auth/session issue. Refresh cookies if needed.`);
        return;
    }

    await screenshotDebugger.captureError(taskContext.page, platform, error);
    await taskContext.reporter.sendStatus(`⚠️ ${platform} skipped due to scraper error: ${error.message}`);
}

async function executeTask(platform, taskDefinition, taskContext) {
    const startedAt = Date.now();
    const timeoutMs = taskContext.runPolicy.getTimeoutMs(platform);

    if (!taskContext.runPolicy.shouldRun(platform)) {
        return createTaskResult({
            platform,
            status: 'skipped',
            warnings: ['Platform not selected for this run'],
            startedAt
        });
    }

    const ownsTaskPage = Boolean(taskContext.context && platform !== 'cloudflare');
    const taskPage = ownsTaskPage ? await taskContext.context.newPage() : taskContext.page;
    const scopedTaskContext = {
        ...taskContext,
        page: taskPage
    };

    try {
        const rawResult = await withTimeout(
            () => taskDefinition.run(scopedTaskContext),
            timeoutMs,
            `${platform} task timed out after ${timeoutMs}ms`
        );
        const normalized = normalizeScrapeResult(platform, rawResult);

        return createTaskResult({
            platform,
            status: normalized.status,
            rawJobs: normalized.rawJobs,
            staleUrls: normalized.staleUrls,
            warnings: normalized.warnings,
            error: normalized.error,
            metrics: normalized.metrics,
            startedAt
        });
    } catch (error) {
        if (error.code === 'TASK_TIMEOUT') {
            await taskPage.close().catch(() => { });
            await scopedTaskContext.reporter.sendStatus(`⚠️ ${platform} timed out after ${Math.round(timeoutMs / 1000)}s and was skipped.`);
        } else {
            await captureTaskFailure(platform, scopedTaskContext, error);
        }
        return createTaskResult({
            platform,
            status: 'failed',
            warnings: [error.code === 'TASK_TIMEOUT' ? 'Task timed out and was skipped' : 'Task failed and was skipped'],
            error: error.message,
            startedAt
        });
    } finally {
        if (ownsTaskPage && !taskPage.isClosed()) {
            await taskPage.close().catch(() => { });
        }
    }
}

async function collectTaskResults(taskContext) {
    const taskDefinitions = getTaskDefinitions();
    const taskResults = [];

    for (const platform of taskContext.runPolicy.taskOrder) {
        const taskResult = await executeTask(platform, taskDefinitions[platform], taskContext);
        taskResults.push(taskResult);
    }

    return taskResults;
}

module.exports = { collectTaskResults };
