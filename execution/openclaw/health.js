const fs = require('fs');

const CONFIG = require('../config');

function loadPlatformHealth() {
    try {
        if (!fs.existsSync(CONFIG.paths.platformHealth)) {
            return { platforms: {} };
        }
        return JSON.parse(fs.readFileSync(CONFIG.paths.platformHealth, 'utf-8'));
    } catch (error) {
        console.warn(`⚠️ Failed to load platform health: ${error.message}`);
        return { platforms: {} };
    }
}

function savePlatformHealth(healthState) {
    try {
        fs.writeFileSync(CONFIG.paths.platformHealth, JSON.stringify(healthState, null, 2));
    } catch (error) {
        console.warn(`⚠️ Failed to save platform health: ${error.message}`);
    }
}

function createHealthTracker({ blockedThreshold = 3, failedThreshold = 3 } = {}) {
    const healthState = loadPlatformHealth();
    const alerts = [];

    return {
        healthState,
        alerts,
        updateFromTaskResults(taskResults = []) {
            const now = new Date().toISOString();

            for (const taskResult of taskResults) {
                if (taskResult.status === 'skipped') continue;

                const platformState = healthState.platforms[taskResult.platform] || {
                    consecutiveBlocked: 0,
                    consecutiveFailed: 0,
                    lastStatus: 'unknown',
                    lastAlertKey: null,
                    updatedAt: null
                };

                if (taskResult.status === 'blocked') {
                    platformState.consecutiveBlocked += 1;
                    platformState.consecutiveFailed = 0;
                } else if (taskResult.status === 'failed') {
                    platformState.consecutiveFailed += 1;
                    platformState.consecutiveBlocked = 0;
                } else {
                    platformState.consecutiveBlocked = 0;
                    platformState.consecutiveFailed = 0;
                }

                platformState.lastStatus = taskResult.status;
                platformState.updatedAt = now;

                const blockedAlertKey = `blocked:${platformState.consecutiveBlocked}`;
                const failedAlertKey = `failed:${platformState.consecutiveFailed}`;

                if (platformState.consecutiveBlocked >= blockedThreshold && platformState.lastAlertKey !== blockedAlertKey) {
                    alerts.push({
                        platform: taskResult.platform,
                        kind: 'blocked',
                        consecutiveCount: platformState.consecutiveBlocked,
                        message: `${taskResult.platform} has been blocked for ${platformState.consecutiveBlocked} consecutive runs.`
                    });
                    platformState.lastAlertKey = blockedAlertKey;
                } else if (platformState.consecutiveFailed >= failedThreshold && platformState.lastAlertKey !== failedAlertKey) {
                    alerts.push({
                        platform: taskResult.platform,
                        kind: 'failed',
                        consecutiveCount: platformState.consecutiveFailed,
                        message: `${taskResult.platform} has failed for ${platformState.consecutiveFailed} consecutive runs.`
                    });
                    platformState.lastAlertKey = failedAlertKey;
                } else if (taskResult.status === 'success' || taskResult.status === 'partial') {
                    platformState.lastAlertKey = null;
                }

                healthState.platforms[taskResult.platform] = platformState;
            }

            savePlatformHealth(healthState);
            return alerts;
        }
    };
}

module.exports = { createHealthTracker };
