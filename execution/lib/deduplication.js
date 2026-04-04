/**
 * Deduplication - Track seen jobs to avoid duplicate notifications
 */

const fs = require('fs');
const CONFIG = require('../config');

function getRetentionCutoff(now = Date.now()) {
    return now - (CONFIG.seenJobsRetentionDays * 24 * 60 * 60 * 1000);
}

function normalizeEntry(entry, fallbackTimestamp = Date.now()) {
    if (!entry) return null;

    if (typeof entry === 'string') {
        return { url: entry, timestamp: fallbackTimestamp, status: 'sent' };
    }

    if (!entry.url) return null;

    return {
        url: entry.url,
        timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : fallbackTimestamp,
        status: entry.status || 'sent'
    };
}

/**
 * Load previously seen job URLs from file
 * @returns {Set<string>} Set of job URLs that have been sent before
 */
function loadSeenJobs() {
    try {
        if (fs.existsSync(CONFIG.paths.seenJobs)) {
            const data = JSON.parse(fs.readFileSync(CONFIG.paths.seenJobs, 'utf-8'));
            const cutoff = getRetentionCutoff();
            const validEntries = data
                .map(entry => normalizeEntry(entry))
                .filter(entry => entry && entry.timestamp > cutoff);
            console.log(`📋 Loaded ${validEntries.length} previously seen jobs`);
            return new Set(validEntries.map(e => e.url));
        }
    } catch (e) {
        console.log('⚠️ Could not load seen jobs:', e.message);
    }
    return new Set();
}

/**
 * Save seen job URLs to file for future runs
 * @param {string[]} seenUrls - Array of job URLs to mark as seen
 */
function saveSeenJobs(seenUrls) {
    try {
        const now = Date.now();
        const cutoff = getRetentionCutoff(now);
        const merged = new Map();

        if (fs.existsSync(CONFIG.paths.seenJobs)) {
            const existingData = JSON.parse(fs.readFileSync(CONFIG.paths.seenJobs, 'utf-8'));
            for (const entry of existingData) {
                const normalized = normalizeEntry(entry, now);
                if (normalized && normalized.timestamp > cutoff) {
                    merged.set(normalized.url, normalized);
                }
            }
        }

        for (const item of seenUrls) {
            const normalized = normalizeEntry(item, now);
            if (!normalized) continue;

            const existing = merged.get(normalized.url);
            if (!existing || normalized.timestamp >= existing.timestamp) {
                merged.set(normalized.url, normalized);
            }
        }

        const existingData = Array.from(merged.values())
            .filter(entry => entry.timestamp > cutoff)
            .sort((a, b) => b.timestamp - a.timestamp);

        fs.writeFileSync(CONFIG.paths.seenJobs, JSON.stringify(existingData, null, 2));
        console.log(`💾 Saved ${existingData.length} seen jobs to cache`);
    } catch (e) {
        console.log('⚠️ Could not save seen jobs:', e.message);
    }
}

module.exports = { loadSeenJobs, saveSeenJobs };
