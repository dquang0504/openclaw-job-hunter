const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

const CONFIG = require('../config');

chromium.use(stealth);

function ensureRuntimeDirectories() {
    const directoryKeys = new Set(['cookies', 'logs', 'screenshots']);

    for (const [key, filePath] of Object.entries(CONFIG.paths)) {
        const dirPath = directoryKeys.has(key) ? filePath : path.dirname(filePath);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }
}

function getCookieFiles() {
    return {
        twitter: path.join(CONFIG.paths.cookies, 'cookies-twitter.json'),
        facebook: path.join(CONFIG.paths.cookies, 'cookies-facebook.json'),
        threads: path.join(CONFIG.paths.cookies, 'cookies-threads.json'),
        vercel: path.join(CONFIG.paths.cookies, 'cookies-vercel.json'),
        topdev: path.join(CONFIG.paths.cookies, 'cookies-topdev.json'),
        itviec: path.join(CONFIG.paths.cookies, 'cookies-itviec.json')
    };
}

function sanitizeCookies(cookies = []) {
    return cookies.map(cookie => {
        const nextCookie = {
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path || '/',
            secure: Boolean(cookie.secure),
            httpOnly: Boolean(cookie.httpOnly)
        };
        if (cookie.url) {
            nextCookie.url = cookie.url;
        }
        const expires = Number(cookie.expires ?? cookie.expirationDate);
        if (Number.isFinite(expires) && expires > 0) {
            nextCookie.expires = expires;
        }
        nextCookie.sameSite = cookie.sameSite;
        if (nextCookie.sameSite === 'no_restriction' || nextCookie.sameSite === 'unspecified') {
            nextCookie.sameSite = 'None';
        }
        if (!['Strict', 'Lax', 'None'].includes(nextCookie.sameSite)) {
            delete nextCookie.sameSite;
        }
        return nextCookie;
    });
}

async function loadSessionCookies(context) {
    const cookieFiles = getCookieFiles();

    for (const [name, file] of Object.entries(cookieFiles)) {
        if (!fs.existsSync(file)) continue;

        try {
            const cookieData = JSON.parse(fs.readFileSync(file, 'utf-8'));
            const cookies = Array.isArray(cookieData) ? cookieData : (cookieData.cookies || []);
            if (cookies.length === 0) continue;

            const cleanCookies = sanitizeCookies(cookies);
            await context.addCookies(cleanCookies);
            console.log(`🍪 Loaded ${name} cookies (${cleanCookies.length})`);
        } catch (error) {
            console.warn(`⚠️ Failed to load ${name} cookies:`, error.message);
        }
    }
}

async function createBrowserSession() {
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

    const launchOptions = {
        headless: false,
        timeout: 60000,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--window-size=1280,800',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-first-run',
            '--no-service-autorun',
            '--password-store=basic'
        ]
    };

    if (process.env.PROXY_SERVER) {
        launchOptions.proxy = {
            server: process.env.PROXY_SERVER
        };
        console.log(`🌐 Using Proxy: ${process.env.PROXY_SERVER}`);
    }

    const browser = await chromium.launch(launchOptions);

    const contextOptions = {
        userAgent,
        viewport: { width: 1280, height: 800 },
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh',
        javaScriptEnabled: true
    };

    const context = await browser.newContext(contextOptions);
    await loadSessionCookies(context);
    const page = await context.newPage();

    return {
        browser,
        context,
        page,
        userAgent
    };
}

module.exports = {
    createBrowserSession,
    ensureRuntimeDirectories
};
