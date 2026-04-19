const { scrapeFacebook } = require('../../scrapers/facebook');

async function runFacebookTask({ page, reporter, runState, runPolicy, scrapeFacebookFn = scrapeFacebook }) {
    const facebookPolicy = runPolicy.getPlatformConfig('facebook');
    const groups = facebookPolicy.groups || [];
    const aggregatedJobs = [];
    const aggregatedStaleUrls = [];
    const warnings = [];
    let status = 'success';
    let scannedCount = 0;
    let scannedGroups = 0;
    const startedAt = Date.now();
    const maxRuntimeMs = facebookPolicy.maxRuntimeMs || runPolicy.getTimeoutMs('facebook');
    const shutdownBufferMs = facebookPolicy.shutdownBufferMs || 20_000;
    const minGroupBudgetMs = facebookPolicy.minGroupBudgetMs || 10_000;

    function getRemainingBudgetMs() {
        return maxRuntimeMs - (Date.now() - startedAt) - shutdownBufferMs;
    }

    function runGroupWithBudget(groupUrl, remainingBudgetMs) {
        if (!Number.isFinite(remainingBudgetMs) || remainingBudgetMs <= 0) {
            const error = new Error(`Facebook group ${groupUrl} ran out of runtime budget`);
            error.code = 'FACEBOOK_GROUP_TIMEOUT';
            return Promise.reject(error);
        }

        let timer = null;
        const scrapePromise = Promise.resolve().then(() => scrapeFacebookFn(page, reporter, runState.seenJobs, {
            ...facebookPolicy,
            warmupOnStart: scannedGroups === 1,
            groups: [groupUrl]
        }));

        const budgetPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                const error = new Error(`Facebook group ${groupUrl} exceeded remaining runtime budget`);
                error.code = 'FACEBOOK_GROUP_TIMEOUT';
                reject(error);
            }, remainingBudgetMs);
        });

        scrapePromise.catch(() => {});

        return Promise.race([scrapePromise, budgetPromise]).finally(() => {
            if (timer) clearTimeout(timer);
        });
    }

    for (const groupUrl of groups) {
        const elapsedMs = Date.now() - startedAt;
        const remainingBudgetMs = getRemainingBudgetMs();
        if (remainingBudgetMs <= 0) {
            warnings.push(`Stopped early after ${Math.round(elapsedMs / 1000)}s to stay within Facebook runtime budget`);
            if (status === 'success') status = 'partial';
            break;
        }

        if (remainingBudgetMs < minGroupBudgetMs) {
            warnings.push(`Stopped early with only ${Math.round(remainingBudgetMs / 1000)}s left; not enough budget for another Facebook group`);
            if (status === 'success') status = 'partial';
            break;
        }

        if (facebookPolicy.stopAfterTotalRawJobs && aggregatedJobs.length >= facebookPolicy.stopAfterTotalRawJobs) {
            warnings.push(`Stopped early after reaching ${facebookPolicy.stopAfterTotalRawJobs} raw jobs across groups`);
            break;
        }

        scannedGroups += 1;
        let result;
        try {
            result = await runGroupWithBudget(groupUrl, remainingBudgetMs);
        } catch (error) {
            if (error.code === 'FACEBOOK_GROUP_TIMEOUT') {
                warnings.push(`Stopped during group ${groupUrl} after collecting ${aggregatedJobs.length} raw jobs to preserve Facebook task output`);
                if (status === 'success') status = 'partial';
                await page.close().catch(() => {});
                break;
            }
            throw error;
        }

        aggregatedJobs.push(...(result.jobs || []));
        aggregatedStaleUrls.push(...(result.staleUrls || []));
        warnings.push(...(result.warnings || []));
        scannedCount += result.metrics?.scannedCount || 0;

        if (result.status === 'blocked') {
            status = 'blocked';
            break;
        }
        if (result.status === 'failed' && status !== 'blocked') {
            status = 'failed';
        } else if (result.status === 'partial' && status === 'success') {
            status = 'partial';
        }
    }

    const uniqueJobs = [...new Map(aggregatedJobs.map(job => [job.url, job])).values()];
    const uniqueStaleUrls = [...new Set(aggregatedStaleUrls)];

    return {
        jobs: uniqueJobs,
        staleUrls: uniqueStaleUrls,
        status: warnings.length > 0 && status === 'success' ? 'partial' : status,
        warnings,
        metrics: {
            scannedCount,
            groupCount: scannedGroups
        }
    };
}

module.exports = { runFacebookTask };
