/**
 * Telegram Reporter - Handles all Telegram notifications
 */

const TelegramBot = require('node-telegram-bot-api');

const { formatDateTime } = require('../utils/date');

const TELEGRAM_MESSAGE_LIMIT = 4000;
const TELEGRAM_CAPTION_LIMIT = 900;

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
            // Add description for Facebook posts (serves as preview for manual search)
            (job.source === 'Facebook' && job.description) ? `📄 ${this.escapeMarkdown(job.description)}` : '',
            `🤖 Match Score: ${job.matchScore}/10`,
            `🔖 Source: ${job.source}`,
            `🕒 Found at: ${this.escapeMarkdown(formatDateTime())}`
        ].filter(Boolean).join('\n');

        const inlineKeyboard = {
            inline_keyboard: [
                [
                    { text: '🛠️ Refine CV', url: job.url },
                    { text: '🔗 View Job', url: job.url }
                ]
            ]
        };

        await this.bot.sendMessage(this.chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: inlineKeyboard
        });
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
        await this.bot.sendMessage(this.chatId, this.truncateText(`ℹ️ ${message}`, TELEGRAM_MESSAGE_LIMIT));
    }

    async sendError(error) {
        await this.bot.sendMessage(this.chatId, this.truncateText(`❌ Error: ${error}`, TELEGRAM_MESSAGE_LIMIT));
    }

    async sendPhoto(photoPath, caption = '') {
        const fs = require('fs');
        if (!fs.existsSync(photoPath)) {
            console.error(`❌ Photo not found: ${photoPath}`);
            return;
        }

        const safeCaption = this.truncateText(caption, TELEGRAM_CAPTION_LIMIT);

        try {
            await this.bot.sendPhoto(this.chatId, photoPath, { caption: safeCaption });
        } catch (error) {
            if (error.message && error.message.includes('message caption is too long')) {
                const fallbackCaption = this.truncateText(safeCaption, 256);
                await this.bot.sendPhoto(this.chatId, photoPath, { caption: fallbackCaption });
                return;
            }
            throw error;
        }
    }

    escapeMarkdown(text) {
        return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
    }

    truncateText(text, maxLength) {
        const normalized = `${text || ''}`.replace(/\r/g, '').trim();
        if (normalized.length <= maxLength) {
            return normalized;
        }

        return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
    }
}

module.exports = TelegramReporter;
