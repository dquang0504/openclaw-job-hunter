/**
 * Configuration for OpenClaw Job Search
 */

const path = require('path');

const CONFIG = {
    keywords: [
        'golang fresher',
        'remote intern golang',
        'junior golang developer',
        'golang backend intern',
        'entry level golang',
        'go developer fresher',
        'golang internship'
    ],
    keywordRegex: /\b(golang|go\s+developer|go\s+backend)\b/i,
    excludeRegex: /\b(senior|lead|manager|principal|staff|architect|\d{2,}\+?\s*years?|[3-9]\s*years?)\b/i,
    includeRegex: /\b(fresher|intern|junior|entry[\s-]?level|graduate|trainee)\b/i,

    // Only accept jobs from current year and previous year
    validYears: [new Date().getFullYear(), new Date().getFullYear() - 1],

    locations: {
        primary: ['cần thơ', 'can tho', 'remote', 'từ xa'],
        secondary: ['ho chi minh', 'hồ chí minh', 'hanoi', 'hà nội', 'worldwide', 'global']
    },

    delays: {
        min: 500,
        max: 1500,
        scroll: { min: 200, max: 500 },
        typing: { min: 30, max: 80 }
    },

    paths: {
        cookies: path.join(__dirname, '..', '.cookies'),
        logs: path.join(__dirname, '..', 'logs'),
        screenshots: path.join(__dirname, '..', '.tmp', 'screenshots'),
        seenJobs: path.join(__dirname, '..', 'logs', 'seen-jobs.json')
    }
};

module.exports = CONFIG;
