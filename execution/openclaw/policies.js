const CONFIG = require('../config');

function createRunPolicy(args = []) {
    const isDryRun = args.includes('--dry-run');
    const skipAI = args.includes('--no-ai');
    const platformArg = args.find(arg => arg.startsWith('--platform='));
    const platformParam = platformArg ? platformArg.split('=')[1] : 'all';
    const platforms = platformParam.split(',');
    const taskOrder = [...CONFIG.platforms.active];
    const platformTimeouts = {
        twitterMs: 90_000,
        facebookMs: 15 * 60_000,
        threadsMs: 90_000,
        indeedMs: 90_000,
        topdevMs: 90_000,
        itviecMs: 90_000,
        vercelMs: 60_000,
        cloudflareMs: 30_000
    };
    const platformConfigs = {
        facebook: {
            groups: CONFIG.facebookGroups,
            maxPostsPerGroup: 8,
            maxNewJobsPerGroup: 5,
            stopAfterTotalRawJobs: 8,
            searchSettleMinMs: 3500,
            searchSettleMaxMs: 6500,
            preOpenPostMinMs: 1200,
            preOpenPostMaxMs: 2800,
            detailReadMinMs: 1500,
            detailReadMaxMs: 3200,
            groupCooldownMinMs: 8000,
            groupCooldownMaxMs: 15000
        }
    };

    return {
        args,
        isDryRun,
        skipAI,
        platformParam,
        platforms,
        taskOrder,
        maxJobsToSend: 8,
        platformTimeouts,
        platformConfigs,
        shouldRun(platform) {
            return platforms.includes('all') || platforms.includes(platform);
        },
        getTimeoutMs(platform) {
            return platformTimeouts[`${platform}Ms`] || 90_000;
        },
        getPlatformConfig(platform) {
            return platformConfigs[platform] || {};
        }
    };
}

module.exports = { createRunPolicy };
