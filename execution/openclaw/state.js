const { loadSeenJobs, saveSeenJobs } = require('../lib/deduplication');

function createRunState() {
    const seenJobs = loadSeenJobs();
    const pendingSeenEntries = new Map();

    return {
        seenJobs,
        queueSeenEntries(items, status) {
            const now = Date.now();
            for (const item of items || []) {
                const entry = typeof item === 'string'
                    ? { url: item, timestamp: now, status }
                    : { ...item, timestamp: item.timestamp || now, status: item.status || status };

                if (!entry.url) continue;

                const existing = pendingSeenEntries.get(entry.url);
                if (!existing || entry.timestamp >= existing.timestamp) {
                    pendingSeenEntries.set(entry.url, entry);
                }
            }
        },
        persistSeenEntries(isDryRun = false) {
            if (isDryRun || pendingSeenEntries.size === 0) return;
            saveSeenJobs(Array.from(pendingSeenEntries.values()));
        }
    };
}

module.exports = { createRunState };
