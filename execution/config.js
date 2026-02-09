/**
 * Configuration for OpenClaw Job Search
 */

const path = require('path');

const CONFIG = {
    keywords: [
        'golang'
    ],
    keywordRegex: /\b(golang|go\s+developer|go\s+backend|\bGo\b|blockchain)\b/i,
    // Exclude > 2 years
    excludeRegex: /\b(senior|lead|manager|principal|staff|architect|(\d{2,}|[3-9])\s*(\+|plus)?\s*years?|2\+\s*years?)\b/i,
    includeRegex: /\b(fresher|intern|junior|entry[\s-]?level|graduate|trainee)\b/i,

    // Only accept jobs from current year and previous year
    validYears: [new Date().getFullYear(), new Date().getFullYear() - 1],

    locations: {
        primary: ['cần thơ', 'can tho', 'remote', 'từ xa'],
        // User requested ONLY Remote or Can Tho
        secondary: []
    },

    facebookGroups: [
        'https://www.facebook.com/groups/golang.org.vn', // Golang Jobs Viet Nam
        'https://www.facebook.com/groups/1875985159376456', // 'Cần Thơ - IT Jobs'
        'https://www.facebook.com/groups/nodejs.php.python', // 'Tuyển dụng Backend Python, PHP, NodeJS, Golang'
        'https://www.facebook.com/groups/itjobsphp', // 'Tuyển Dụng IT - Việc làm Back-end Java, .NET, Golang, PHP, Python, NodeJS'
        'https://www.facebook.com/groups/ithotjobs.tuyendungit.vieclamcntt.susudev', // IT Hot Jobs
        'https://www.facebook.com/groups/465885632447300', // IT Jobs Group
    ],

    vercelUrl: 'https://vercel.com/dquang0504s-projects/my-portfolio/analytics?period=24h',

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
        seenJobs: path.join(__dirname, '..', 'logs', 'seen-jobs.json'),
        vercelCache: path.join(__dirname, '..', 'logs', 'vercel-cache.json'),
        cloudflareCache: path.join(__dirname, '..', 'logs', 'cloudflare-cache.json')
    },
    cloudflare: {
        accountId: '05bdf9a77d8976b78faf594736063c5d',
        apiToken: process.env.CLOUDFLARE_API_KEY
    }
};

module.exports = CONFIG;
