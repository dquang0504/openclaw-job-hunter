/**
 * Deduplication - Track seen jobs to avoid duplicate notifications
 */

const fs = require('fs');
const CONFIG = require('../config');

/**
 * Load previously seen job URLs from file
 * @returns {Set<string>} Set of job URLs that have been sent before
 */
function loadSeenJobs() {
    try {
        if (fs.existsSync(CONFIG.paths.seenJobs)) {
            const data = JSON.parse(fs.readFileSync(CONFIG.paths.seenJobs, 'utf-8'));
            // Filter out entries older than 30 days
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            const validEntries = data.filter(entry => entry.timestamp > thirtyDaysAgo);
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
        // Load existing and merge
        let existingData = [];
        if (fs.existsSync(CONFIG.paths.seenJobs)) {
            existingData = JSON.parse(fs.readFileSync(CONFIG.paths.seenJobs, 'utf-8'));
        }

        // Add new entries with timestamp
        const now = Date.now();
        for (const url of seenUrls) {
            if (!existingData.some(e => e.url === url)) {
                existingData.push({ url, timestamp: now });
            }
        }

        // Filter out entries older than 30 days
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
        existingData = existingData.filter(e => e.timestamp > thirtyDaysAgo);

        fs.writeFileSync(CONFIG.paths.seenJobs, JSON.stringify(existingData, null, 2));
        console.log(`💾 Saved ${existingData.length} seen jobs to cache`);
    } catch (e) {
        console.log('⚠️ Could not save seen jobs:', e.message);
    }
}

module.exports = { loadSeenJobs, saveSeenJobs };
