/**
 * Job Filters - Scoring and filtering logic
 */

const CONFIG = require('../config');

/**
 * Calculate match score for a job (0-10)
 */
function calculateMatchScore(job) {
    let score = 0;
    const text = `${job.title} ${job.description || ''} ${job.company}`.toLowerCase();

    // Golang mention (+3)
    if (CONFIG.keywordRegex.test(text)) score += 3;

    // Level match (+3)
    if (CONFIG.includeRegex.test(text)) score += 3;

    // Location priority (+2 for primary, +1 for secondary)
    const location = (job.location || '').toLowerCase();
    if (CONFIG.locations.primary.some(l => location.includes(l))) score += 2;
    else if (CONFIG.locations.secondary.some(l => location.includes(l))) score += 1;

    // Tech stack bonus (+1)
    if (/\b(docker|kubernetes|aws|gcp|microservices|rest\s*api|grpc)\b/i.test(text)) score += 1;

    return Math.min(score, 10);
}

/**
 * Check if job should be included based on criteria
 */
function shouldIncludeJob(job) {
    const text = `${job.title} ${job.description || ''}`.toLowerCase();

    // Must contain golang/go
    if (!CONFIG.keywordRegex.test(text)) return false;

    // Exclude senior/lead/manager or >2 years
    if (CONFIG.excludeRegex.test(text)) return false;

    // Must be from valid years
    if (!isRecentJob(job.postedDate)) return false;

    return true;
}

/**
 * Check if a job was posted within valid years (current or previous year)
 * @param {string} dateStr - Date string like "31/01/2026" or "N/A"
 */
function isRecentJob(dateStr) {
    if (!dateStr || dateStr === 'N/A') {
        return true; // Assume recent if no date
    }

    try {
        let year;
        if (dateStr.includes('/')) {
            const parts = dateStr.split('/');
            year = parseInt(parts[2] || parts[1]);
        } else if (dateStr.includes('-')) {
            const parts = dateStr.split('-');
            year = parseInt(parts[0]);
        } else {
            const yearMatch = dateStr.match(/\b(20\d{2})\b/);
            year = yearMatch ? parseInt(yearMatch[1]) : null;
        }

        if (year && CONFIG.validYears.includes(year)) {
            return true;
        }

        if (year) {
            return false;
        }
    } catch (e) {
        return true;
    }

    return true;
}

module.exports = { calculateMatchScore, shouldIncludeJob, isRecentJob };
