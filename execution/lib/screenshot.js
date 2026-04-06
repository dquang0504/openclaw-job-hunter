/**
 * Screenshot Utility for Debugging
 * Captures screenshots on errors and sends to Telegram
 */

const fs = require('fs');
const path = require('path');

class ScreenshotDebugger {
    constructor(reporter) {
        this.reporter = reporter;
        this.screenshotDir = path.join(__dirname, '../../.tmp/screenshots');

        // Ensure directory exists
        if (!fs.existsSync(this.screenshotDir)) {
            fs.mkdirSync(this.screenshotDir, { recursive: true });
        }
    }

    /**
     * Capture screenshot and send to Telegram
     * @param {Page} page - Playwright page object
     * @param {string} context - Context/reason for screenshot (e.g., "topdev-cloudflare")
     * @param {string} message - Optional message to send with screenshot
     */
    async captureAndSend(page, context, message = '') {
        try {
            // Check if page is still open
            if (page.isClosed()) {
                console.log('⚠️ Cannot capture screenshot: page is closed');
                return;
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `${context}-${timestamp}.png`;
            const filepath = path.join(this.screenshotDir, filename);

            // Capture screenshot
            await page.screenshot({
                path: filepath,
                fullPage: true,
                timeout: 5000
            });

            console.log(`📸 Screenshot saved: ${filename}`);

            // Send to Telegram if reporter available
            if (this.reporter && this.reporter.sendPhoto) {
                const caption = message || `🔍 Debug Screenshot: ${context}`;
                await this.reporter.sendPhoto(filepath, caption);
                console.log(`📤 Screenshot sent to Telegram`);
            }

            return filepath;
        } catch (error) {
            console.error(`❌ Screenshot capture failed: ${error.message}`);
            return null;
        }
    }

    async capture(page, context, message = '') {
        return this.captureAndSend(page, context, message);
    }

    /**
     * Capture screenshot on Cloudflare detection
     */
    async captureCloudflare(page, platform) {
        const pageTitle = await page.title().catch(() => 'Unknown');
        const url = page.url();

        const message = `🛡️ Cloudflare Challenge Detected\n\n` +
            `Platform: ${platform}\n` +
            `Title: ${pageTitle}\n` +
            `URL: ${url}`;

        return await this.captureAndSend(page, `${platform}-cloudflare`, message);
    }

    /**
     * Capture screenshot on error
     */
    async captureError(page, platform, error) {
        const url = page && !page.isClosed() ? page.url() : 'Unknown';

        const message = `❌ Error in ${platform} Scraper\n\n` +
            `Error: ${error.message}\n` +
            `URL: ${url}`;

        return await this.captureAndSend(page, `${platform}-error`, message);
    }

    async captureAuthIssue(page, platform, reason = 'Login required or session expired') {
        const url = page && !page.isClosed() ? page.url() : 'Unknown';

        const message = `🔐 Auth issue in ${platform} scraper\n\n` +
            `Reason: ${reason}\n` +
            `URL: ${url}\n\n` +
            `Action: Skipping scraper. Refresh cookies/session if needed.`;

        return await this.captureAndSend(page, `${platform}-auth`, message);
    }

    /**
     * Capture screenshot when no jobs found
     */
    async captureNoJobs(page, platform) {
        const url = page.url();

        const message = `⚠️ No Jobs Found\n\n` +
            `Platform: ${platform}\n` +
            `URL: ${url}`;

        return await this.captureAndSend(page, `${platform}-nojobs`, message);
    }
}

module.exports = ScreenshotDebugger;
