/**
 * Utility functions for OpenClaw
 */

const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';

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

module.exports = { formatDateTime, formatDate, getTodayVN };
