/**
 * Stealth Utilities - Human-like browser behavior
 */

const CONFIG = require('../config');

/**
 * Random delay between min and max milliseconds
 */
function randomDelay(min = CONFIG.delays.min, max = CONFIG.delays.max) {
    return new Promise(resolve =>
        setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
    );
}

/**
 * Simulate human-like scrolling
 */
async function humanScroll(page) {
    await page.evaluate(() => {
        window.scrollBy(0, Math.floor(Math.random() * 500) + 200);
    });
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

module.exports = { randomDelay, humanScroll, humanType };
