const { scrapeFacebook } = require('../../scrapers/facebook');

async function runFacebookTask({ page, reporter, runState, runPolicy }) {
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

    for (const groupUrl of groups) {
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs >= Math.max(0, maxRuntimeMs - shutdownBufferMs)) {
            warnings.push(`Stopped early after ${Math.round(elapsedMs / 1000)}s to stay within Facebook runtime budget`);
            if (status === 'success') status = 'partial';
            break;
        }

        if (facebookPolicy.stopAfterTotalRawJobs && aggregatedJobs.length >= facebookPolicy.stopAfterTotalRawJobs) {
            warnings.push(`Stopped early after reaching ${facebookPolicy.stopAfterTotalRawJobs} raw jobs across groups`);
            break;
        }

        scannedGroups += 1;
        const result = await scrapeFacebook(page, reporter, runState.seenJobs, {
            ...facebookPolicy,
            warmupOnStart: scannedGroups === 1,
            groups: [groupUrl]
        });

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
