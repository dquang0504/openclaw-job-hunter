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

    // Tech stack bonus (+1) -> Added 'backend'
    if (/\b(docker|kubernetes|aws|gcp|microservices|rest\s*api|grpc|backend|back-end)\b/i.test(text)) score += 1;

    // PENALTY: Experience > 2 years (Heavy penalty to force score < 5)
    // Matches: "3 years", "3 nam", "3+ years"
    if (/\b([3-9]|\d{2,})\s*(\+|plus)?\s*(năm|nam|years?|yoe)\b/i.test(text)) {
        console.log(`    ⚠️ Penalty applied: High YoE detected`);
        score -= 5;
    }

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

    // Direct check for "3 years", "3 nam", "3+ years"
    if (/\b([3-9]|\d{2,})\s*(\+|plus)?\s*(năm|years?|yoe)\b/i.test(text)) return false;

    // Must be from valid years
    if (!isRecentJob(job.postedDate)) return false;

    return true;
}

/**
 * Check if a job was posted within valid years (current or previous year)
 * @param {string} dateStr - Date string like "31/01/2026" or "N/A"
 */
// Update to handle various formats and STRICT 60 days
function isRecentJob(dateStr) {
    if (!dateStr || dateStr === 'N/A' || dateStr === 'Recent') {
        return true;
    }

    try {
        let date = null;
        const now = new Date();
        const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;

        // Threads/ISO format or "2026-01-27"
        if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
            date = new Date(dateStr);
        }
        // "27/01/2026" or "1/27/2026"
        else if (dateStr.includes('/')) {
            const parts = dateStr.split(/[\/\s]/);
            // heuristic: assume day/month/year or month/day/year?
            // standard is usually dd/mm/yyyy in VN contexts
            const d = parseInt(parts[0]);
            const m = parseInt(parts[1]) - 1; // 0-indexed
            const y = parseInt(parts[2]);
            if (!isNaN(y)) date = new Date(y, m, d);
        }

        if (date && !isNaN(date.getTime())) {
            const diff = now - date;
            if (diff > sixtyDaysMs) return false;
            // Also reject future dates > 2 days (timezone issues)
            if (diff < -2 * 24 * 3600 * 1000) return false;
            return true;
        }

        // Fallback for year only
        let year;
        const yearMatch = dateStr.match(/\b(20\d{2})\b/);
        if (yearMatch) year = parseInt(yearMatch[1]);

        if (year && CONFIG.validYears.includes(year)) return true;
        if (year) return false;

    } catch (e) {
        return true;
    }

    return true;
}

module.exports = { calculateMatchScore, shouldIncludeJob, isRecentJob };
