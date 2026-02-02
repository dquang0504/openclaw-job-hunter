/**
 * Enhanced Stealth Utilities - Human-like browser behavior
 * Includes anti-detection measures for LinkedIn Guest Mode
 */

const CONFIG = require('../config');

// Top 20 most common real user agents
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
];

/**
 * Get a random user agent from the pool
 */
function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Random delay between min and max milliseconds
 */
function randomDelay(min = CONFIG.delays.min, max = CONFIG.delays.max) {
    return new Promise(resolve =>
        setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
    );
}

/**
 * "Thinking delay" - random 2-7 seconds for human mimicry
 */
function thinkingDelay() {
    const t = Math.floor(Math.random() * 5000) + 2000; // 2-7 seconds
    return new Promise(resolve => setTimeout(resolve, t));
}

/**
 * Simulate human-like smooth scrolling
 */
async function smoothScroll(page, distance = null) {
    const scrollDistance = distance || Math.floor(Math.random() * 500) + 200;
    const steps = Math.floor(Math.random() * 5) + 3; // 3-8 steps
    const stepDistance = scrollDistance / steps;

    for (let i = 0; i < steps; i++) {
        await page.evaluate((d) => window.scrollBy(0, d), stepDistance);
        await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
    }
}

/**
 * Simulate human-like scrolling (simple version)
 */
async function humanScroll(page) {
    await page.evaluate(() => {
        window.scrollBy(0, Math.floor(Math.random() * 500) + 200);
    });
}

/**
 * Simulate mouse jiggling (natural mouse movement)
 */
async function mouseJiggle(page) {
    const startX = Math.floor(Math.random() * 800) + 100;
    const startY = Math.floor(Math.random() * 400) + 100;

    // Move to random position
    await page.mouse.move(startX, startY);

    // Small jiggle movements
    for (let i = 0; i < 3; i++) {
        const jiggleX = startX + (Math.random() - 0.5) * 20;
        const jiggleY = startY + (Math.random() - 0.5) * 20;
        await page.mouse.move(jiggleX, jiggleY);
        await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
    }
}

/**
 * Simulate human-like typing with random delays
 */
async function humanType(page, selector, text) {
    for (const char of text) {
        await page.type(selector, char, {
            delay: Math.floor(Math.random() * (CONFIG.delays.typing.max - CONFIG.delays.typing.min)) + CONFIG.delays.typing.min
        });
    }
}

/**
 * Apply stealth settings to browser context
 */
async function applyStealthSettings(page) {
    // Override navigator properties
    await page.addInitScript(() => {
        // Spoof webdriver - multiple properties
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.navigator.chrome = { runtime: {} };

        // Mock Plugins aiming for standard Chrome on Linux
        Object.defineProperty(navigator, 'plugins', {
            get: () => {
                return [
                    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format' },
                    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
                ];
            }
        });

        // Pass standard languages
        Object.defineProperty(navigator, 'languages', {
            get: () => ['vi-VN', 'vi', 'en-US', 'en']
        });

        // Permissions spoofing
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) =>
            parameters.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission })
                : originalQuery(parameters);

        // Hide automation from CDC (Chrome DevTools Protocol)
        // Note: This is partial, robust evasion requires args at launch like --disable-blink-features=AutomationControlled
    });
}

module.exports = {
    randomDelay,
    thinkingDelay,
    humanScroll,
    smoothScroll,
    mouseJiggle,
    humanType,
    getRandomUserAgent,
    applyStealthSettings,
    USER_AGENTS
};
