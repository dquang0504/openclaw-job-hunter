const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = process.argv[2] || '.tmp/artifacts';
const OUTPUT_FILE = process.argv[3] || 'logs/platform-health.json';
const BLOCKED_THRESHOLD = 3;
const FAILED_THRESHOLD = 3;

function loadJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (error) {
        console.warn(`⚠️ Failed to parse ${filePath}: ${error.message}`);
        return fallback;
    }
}

function saveJson(filePath, value) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function scanTelemetryFiles(dir, files = []) {
    if (!fs.existsSync(dir)) return files;

    for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            scanTelemetryFiles(fullPath, files);
        } else if (entry.startsWith('openclaw-run-') && entry.endsWith('.json')) {
            files.push(fullPath);
        }
    }

    return files;
}

function pickCurrentRunStatuses(telemetryFiles) {
    const currentStatuses = new Map();

    for (const filePath of telemetryFiles) {
        const telemetry = loadJson(filePath, null);
        if (!telemetry || !Array.isArray(telemetry.tasks)) continue;

        for (const task of telemetry.tasks) {
            const existing = currentStatuses.get(task.platform);
            if (!existing || existing.status === 'skipped' || task.status !== 'skipped') {
                currentStatuses.set(task.platform, task);
            }
        }
    }

    return currentStatuses;
}

async function sendTelegramAlert(message) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text: `⚠️ ${message}`
        })
    });

    if (!response.ok) {
        const body = await response.text();
        console.warn(`⚠️ Failed to send platform health alert: ${response.status} ${body}`);
    }
}

async function main() {
    const state = loadJson(OUTPUT_FILE, { platforms: {} });
    const telemetryFiles = scanTelemetryFiles(ARTIFACTS_DIR);
    const currentStatuses = pickCurrentRunStatuses(telemetryFiles);
    const now = new Date().toISOString();

    for (const [platform, task] of currentStatuses.entries()) {
        if (task.status === 'skipped') continue;

        const platformState = state.platforms[platform] || {
            consecutiveBlocked: 0,
            consecutiveFailed: 0,
            lastStatus: 'unknown',
            lastAlertKey: null,
            updatedAt: null
        };

        if (task.status === 'blocked') {
            platformState.consecutiveBlocked += 1;
            platformState.consecutiveFailed = 0;
        } else if (task.status === 'failed') {
            platformState.consecutiveFailed += 1;
            platformState.consecutiveBlocked = 0;
        } else {
            platformState.consecutiveBlocked = 0;
            platformState.consecutiveFailed = 0;
            platformState.lastAlertKey = null;
        }

        platformState.lastStatus = task.status;
        platformState.updatedAt = now;

        const blockedAlertKey = `blocked:${platformState.consecutiveBlocked}`;
        const failedAlertKey = `failed:${platformState.consecutiveFailed}`;

        if (platformState.consecutiveBlocked >= BLOCKED_THRESHOLD && platformState.lastAlertKey !== blockedAlertKey) {
            await sendTelegramAlert(`${platform} has been blocked for ${platformState.consecutiveBlocked} consecutive runs.`);
            platformState.lastAlertKey = blockedAlertKey;
        } else if (platformState.consecutiveFailed >= FAILED_THRESHOLD && platformState.lastAlertKey !== failedAlertKey) {
            await sendTelegramAlert(`${platform} has failed for ${platformState.consecutiveFailed} consecutive runs.`);
            platformState.lastAlertKey = failedAlertKey;
        }

        state.platforms[platform] = platformState;
    }

    saveJson(OUTPUT_FILE, state);
    console.log(`✅ Updated platform health: ${OUTPUT_FILE}`);
}

main().catch(error => {
    console.error(`❌ update-platform-health failed: ${error.message}`);
    process.exit(1);
});
