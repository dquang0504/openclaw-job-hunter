/**
 * Job Filters - Scoring and filtering logic
 */

const CONFIG = require('../config');
const { getJobFreshnessInfo } = require('../utils/date');

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

    // Tech stack bonus (+1) -> Added 'backend', 'fullstack'
    if (/\b(docker|kubernetes|aws|gcp|microservices|rest\s*api|grpc|backend|back-end|fullstack|full-stack)\b/i.test(text)) score += 1;

    // PENALTY: Experience >= 3 years (Zero score)
    // Matches: "3 years", "3 nam", "3+ years", "4 năm", "5 nam"
    // Also matches "Minimum 4 years", "Tối thiểu 4 năm"
    const experienceRegex = /\b([3-9]|\d{2,})\s*(\+|plus)?\s*(năm|nam|years?|yrs?|yoe)\b/i;
    if (experienceRegex.test(text)) {
        console.log(`    ⚠️ REJECTED: High YoE detected`);
        score = 0; // Immediate rejection
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
    if (/\b([3-9]|\d{2,})\s*(\+|plus)?\s*(năm|nam|years?|yrs?|yoe)\b/i.test(text)) return false;

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
    return getJobFreshnessInfo(dateStr, {
        freshnessDays: CONFIG.jobFreshnessDays,
        allowUnknownRecent: true
    }).isFresh;
}

module.exports = { calculateMatchScore, shouldIncludeJob, isRecentJob };
