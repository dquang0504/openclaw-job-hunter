/**
 * Utility functions for OpenClaw
 */

const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Format a date to YYYY-MM-DD HH:mm:ss in Vietnamese timezone (UTC+7).
 * Always uses VN timezone regardless of server locale to avoid "Found at" being wrong.
 */
function formatDateTime(date = new Date()) {
    // Use Intl.DateTimeFormat to correctly convert to VN timezone
    // This works even if the server is UTC (e.g. GitHub Actions)
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: VN_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    const parts = formatter.formatToParts(new Date(date));
    const get = (type) => parts.find(p => p.type === type)?.value || '00';

    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * Format a date to YYYY-MM-DD in Vietnamese timezone.
 */
function formatDate(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: VN_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return formatter.format(new Date(date)); // en-CA returns YYYY-MM-DD natively
}

/**
 * Get today's date string YYYY-MM-DD in Vietnamese timezone.
 * Used for cache key comparisons.
 */
function getTodayVN() {
    return formatDate(new Date());
}

function extractDateCandidate(text) {
    if (!text) return null;

    const value = `${text}`.trim();
    const patterns = [
        /\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?/,
        /\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/,
        /\d{1,2}\s+Tháng\s+\d{1,2},\s*\d{4}(?:\s+lúc\s+\d{1,2}:\d{2})?/i,
        /\b(?:today|yesterday|recent|just now|hôm nay|hôm qua|vừa xong)\b/i,
        /\b(?:past\s+(?:hour|day|week|month)|\d+\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?|phút|phut|gio|giờ|ngày|ngay|tuan|tuần|tháng|thang)\s*(?:ago|trước|truoc)?)\b/i
    ];

    for (const pattern of patterns) {
        const match = value.match(pattern);
        if (match) return match[0].trim();
    }

    return null;
}

function parseJobDate(dateInput, now = new Date()) {
    if (!dateInput) return null;

    const raw = `${dateInput}`.trim();
    if (!raw || ['n/a', 'unknown', 'recent'].includes(raw.toLowerCase())) {
        return null;
    }

    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (slashMatch) {
        const [, day, month, year, hour = '0', minute = '0', second = '0'] = slashMatch;
        const parsed = new Date(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour),
            Number(minute),
            Number(second)
        );
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const vnMatch = raw.match(/(\d{1,2})\s+Tháng\s+(\d{1,2}),\s*(\d{4})(?:\s+lúc\s+(\d{1,2}):(\d{2}))?/i);
    if (vnMatch) {
        const [, day, month, year, hour = '0', minute = '0'] = vnMatch;
        const parsed = new Date(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour),
            Number(minute),
            0
        );
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    if (/(^|\b)(just now|vua xong)(\b|$)/.test(normalized)) return new Date(now);
    if (/(^|\b)(today|hom nay)(\b|$)/.test(normalized)) return new Date(now);
    if (/(^|\b)(yesterday|hom qua)(\b|$)/.test(normalized)) {
        return new Date(now.getTime() - DAY_MS);
    }

    const relativeMatch = normalized.match(/(\d+)\s*(months?|thang|tháng|minutes?|mins?|min|phut|hours?|hrs?|gio|giờ|days?|ngay|ngày|weeks?|tuan|tuần|h|d|w)\s*(ago|truoc|trước)?/);
    if (relativeMatch) {
        const value = Number(relativeMatch[1]);
        const unit = relativeMatch[2];

        let diffMs = 0;
        if (/^(months?|thang|tháng)$/.test(unit)) diffMs = value * 30 * DAY_MS;
        else if (/^(minutes?|mins?|min|phut)$/.test(unit)) diffMs = value * 60 * 1000;
        else if (/^(hours?|hrs?|gio|giờ|h)$/.test(unit)) diffMs = value * 60 * 60 * 1000;
        else if (/^(days?|ngay|ngày|d)$/.test(unit)) diffMs = value * DAY_MS;
        else if (/^(weeks?|tuan|tuần|w)$/.test(unit)) diffMs = value * 7 * DAY_MS;

        if (diffMs > 0) return new Date(now.getTime() - diffMs);
    }

    if (/past\s+hour/.test(normalized)) return new Date(now.getTime() - 60 * 60 * 1000);
    if (/past\s+day/.test(normalized)) return new Date(now.getTime() - DAY_MS);
    if (/past\s+week/.test(normalized)) return new Date(now.getTime() - 7 * DAY_MS);
    if (/past\s+month/.test(normalized)) return new Date(now.getTime() - 30 * DAY_MS);

    return null;
}

function getJobFreshnessInfo(dateInput, options = {}) {
    const {
        now = new Date(),
        freshnessDays = 7,
        allowUnknownRecent = true
    } = options;

    const raw = dateInput == null ? '' : `${dateInput}`.trim();
    const parsedDate = parseJobDate(raw, now);

    if (!raw || raw.toLowerCase() === 'n/a' || raw.toLowerCase() === 'unknown') {
        return {
            raw,
            parsedDate: null,
            isKnown: false,
            isFresh: allowUnknownRecent,
            isStale: false,
            ageMs: null
        };
    }

    if (!parsedDate) {
        const recentLabel = raw.toLowerCase() === 'recent';
        return {
            raw,
            parsedDate: null,
            isKnown: false,
            isFresh: recentLabel ? allowUnknownRecent : allowUnknownRecent,
            isStale: false,
            ageMs: null
        };
    }

    const ageMs = now.getTime() - parsedDate.getTime();
    const maxAgeMs = freshnessDays * DAY_MS;
    const isFuture = ageMs < -2 * DAY_MS;
    const isFresh = !isFuture && ageMs <= maxAgeMs;

    return {
        raw,
        parsedDate,
        isKnown: true,
        isFresh,
        isStale: !isFresh,
        ageMs
    };
}

module.exports = {
    DAY_MS,
    extractDateCandidate,
    formatDateTime,
    formatDate,
    getJobFreshnessInfo,
    getTodayVN,
    parseJobDate
};
