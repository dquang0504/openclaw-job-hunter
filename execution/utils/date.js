/**
 * Utility functions for OpenClaw
 */

function formatDateTime(date = new Date()) {
    const d = new Date(date);
    const pad = (n) => n.toString().padStart(2, '0');

    // YYYY-MM-DD HH:mm:ss
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDate(date = new Date()) {
    const d = new Date(date);
    const pad = (n) => n.toString().padStart(2, '0');
    // YYYY-MM-DD
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

module.exports = { formatDateTime, formatDate };
