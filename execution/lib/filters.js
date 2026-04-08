/**
 * Job Filters - Scoring and filtering logic
 */

const CONFIG = require('../config');
const { getJobFreshnessInfo } = require('../utils/date');
const HIGH_EXPERIENCE_REGEX = /\b([3-9]|\d{2,})\s*(\+|plus)?\s*(năm|nam|years?|yrs?|yoe)\b/i;
const TARGET_LEVEL_REGEX = /\b(fresher|intern|junior|entry[\s-]?level|graduate|trainee)\b/i;
const LOW_EXPERIENCE_REGEX = /\b([01]|2)\s*(\+|plus)?\s*(năm|nam|years?|yrs?|yoe)\b/i;
const HANOI_REGEX = /\b(hn|hanoi|ha noi|thu do|ha noi city)\b/i;
const HCM_REGEX = /\b(hcm|ho chi minh|saigon|tphcm|hochiminh|tp hcm)\b/i;
const CANTHO_REGEX = /\b(can tho|cantho)\b/i;
const REMOTE_REGEX = /\b(remote|tu xa|từ xa|work from home|wfh)\b/i;
const GLOBAL_REGEX = /\b(global|worldwide|world wide|anywhere|from anywhere|international)\b/i;
const UNKNOWN_LOCATION_REGEX = /^\s*(unknown|n\/a|na|not specified|unspecified|negotiable|multiple|various|tbd)\s*$/i;

function normalizeFilterText(text) {
    return (text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function hasTargetLevelSignal(text) {
    return TARGET_LEVEL_REGEX.test(text) || LOW_EXPERIENCE_REGEX.test(text);
}

function hasDisqualifyingLevelSignal(text) {
    return CONFIG.excludeRegex.test(text) || HIGH_EXPERIENCE_REGEX.test(text);
}

function shouldRejectForLevel(text) {
    const normalized = normalizeFilterText(text);
    if (!normalized) return false;

    return hasDisqualifyingLevelSignal(normalized) && !hasTargetLevelSignal(normalized);
}

function isUnknownLocationValue(value) {
    const normalized = normalizeFilterText(value);
    return !normalized || UNKNOWN_LOCATION_REGEX.test(normalized);
}

function hasExplicitNonPreferredLocation(value) {
    if (isUnknownLocationValue(value)) return false;
    const locationInfo = analyzeLocation(value);
    return !locationInfo.hasPreferredLocation;
}

function evaluateJob(job) {
    const text = normalizeFilterText(`${job.title} ${job.description || ''}`);
    const locationText = normalizeFilterText(`${job.location || ''} ${job.title || ''} ${job.description || ''}`);
    const locationInfo = analyzeLocation(locationText);
    const freshnessInfo = getJobFreshnessInfo(job.postedDate, {
        freshnessDays: CONFIG.jobFreshnessDays,
        allowUnknownRecent: true
    });
    const reasons = [];

    if (!CONFIG.keywordRegex.test(text)) reasons.push('missing_keyword');
    if (shouldRejectForLevel(text)) reasons.push('level_reject');
    if (!freshnessInfo.isFresh) reasons.push('stale');
    if (locationInfo.isHanoiOnly) reasons.push('hanoi_only');
    if (hasExplicitNonPreferredLocation(job.location)) reasons.push('non_preferred_location');

    return {
        include: reasons.length === 0,
        reasons,
        locationInfo,
        freshnessInfo
    };
}

function analyzeLocation(text) {
    const normalized = normalizeFilterText(text);
    const isHanoi = HANOI_REGEX.test(normalized);
    const isHCM = HCM_REGEX.test(normalized);
    const isCanTho = CANTHO_REGEX.test(normalized);
    const isRemote = REMOTE_REGEX.test(normalized);
    const isGlobal = GLOBAL_REGEX.test(normalized);

    let preferredLocation = 'Unknown';
    if (isHCM) preferredLocation = 'HCM';
    else if (isCanTho) preferredLocation = 'Can Tho';
    else if (isRemote) preferredLocation = 'Remote';
    else if (isGlobal) preferredLocation = 'Global';
    else if (isHanoi) preferredLocation = 'Hanoi';

    return {
        normalized,
        isHanoi,
        isHCM,
        isCanTho,
        isRemote,
        isGlobal,
        hasPreferredLocation: isHCM || isCanTho || isRemote || isGlobal,
        isHanoiOnly: isHanoi && !isHCM && !isCanTho && !isRemote && !isGlobal,
        preferredLocation
    };
}

/**
 * Calculate match score for a job (0-10)
 */
function calculateMatchScore(job) {
    let score = 0;
    const text = normalizeFilterText(`${job.title} ${job.description || ''} ${job.company}`);

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
    if (shouldRejectForLevel(text)) {
        score = 0; // Immediate rejection
    }

    return Math.min(score, 10);
}

/**
 * Check if job should be included based on criteria
 */
function shouldIncludeJob(job) {
    return evaluateJob(job).include;
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

module.exports = {
    analyzeLocation,
    calculateMatchScore,
    evaluateJob,
    hasTargetLevelSignal,
    hasExplicitNonPreferredLocation,
    isRecentJob,
    isUnknownLocationValue,
    shouldIncludeJob,
    shouldRejectForLevel
};
