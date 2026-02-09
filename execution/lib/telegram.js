/**
 * Telegram Reporter - Handles all Telegram notifications
 */

const TelegramBot = require('node-telegram-bot-api');

const { formatDateTime } = require('../utils/date');

class TelegramReporter {
    constructor() {
        this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
        this.chatId = process.env.TELEGRAM_CHAT_ID;
        this.waitingForConfirmation = false;
    }

    async sendJobReport(job) {
        const message = [
            `🏢 *${this.escapeMarkdown(job.company)}*`,
            `🔗 [View Job](${job.url})`,
            job.salary ? `💰 ${this.escapeMarkdown(job.salary)}` : '',
            `📝 ${this.escapeMarkdown(job.techStack || 'N/A')}`,
            `📍 ${this.escapeMarkdown(job.location || 'N/A')}`,
            job.postedDate ? `📅 ${this.escapeMarkdown(job.postedDate)}` : '',
            // Add preview for Facebook posts (for manual search)
            (job.source === 'Facebook' && job.preview) ? `🔍 Preview: ${this.escapeMarkdown(job.preview)}` : '',
            // Add description for Facebook posts
            (job.source === 'Facebook' && job.description) ? `📄 ${this.escapeMarkdown(job.description)}` : '',
            `🤖 Match Score: ${job.matchScore}/10`,
            `🔖 Source: ${job.source}`,
            `🕒 Found at: ${this.escapeMarkdown(formatDateTime())}`
        ].filter(Boolean).join('\n');

        await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
    }

    async sendCaptchaAlert(screenshotPath) {
        await this.bot.sendMessage(this.chatId,
            '🚨 *CAPTCHA Detected!*\nPlease solve manually and reply `/proceed` to continue.',
            { parse_mode: 'Markdown' }
        );
        await this.bot.sendPhoto(this.chatId, screenshotPath);
        this.waitingForConfirmation = true;
    }

    async sendStatus(message) {
        await this.bot.sendMessage(this.chatId, `ℹ️ ${message}`);
    }

    async sendError(error) {
        await this.bot.sendMessage(this.chatId, `❌ Error: ${error}`);
    }

    escapeMarkdown(text) {
        return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
    }
}

module.exports = TelegramReporter;
