/**
 * debug-browser.js
 * 
 * Mở browser với stealth settings để debug thủ công.
 * 
 * Usage:
 *   node debug-browser                    → Mở browser trắng (about:blank)
 *   node debug-browser threads            → Mở + load cookies-threads.json
 *   node debug-browser linkedin           → Mở + load cookies-linkedin.json
 *   node debug-browser topcv              → Mở + load cookies-topcv.json
 *   node debug-browser threads https://www.threads.com/  → Mở trang cụ thể
 */

require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const site = process.argv[2] || null;       // Tên site (để load cookies)
const startUrl = process.argv[3] || null;   // URL muốn mở (optional)
const browserChannel = process.env.DEBUG_BROWSER_CHANNEL || 'chrome';
const userDataDir = process.env.DEBUG_BROWSER_PROFILE_DIR
    || path.join(__dirname, '.tmp', 'debug-browser-profile', site || 'default');

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

async function main() {
    console.log('🚀 Launching Debug Browser...');
    if (site) console.log(`   Site profile: ${site}`);
    if (startUrl) console.log(`   Start URL: ${startUrl}`);
    console.log(`   Browser channel: ${browserChannel}`);
    console.log(`   User data dir: ${userDataDir}`);
    console.log('');

    fs.mkdirSync(userDataDir, { recursive: true });

    let context;
    try {
        context = await chromium.launchPersistentContext(userDataDir, {
            channel: browserChannel,
            headless: false,
            viewport: null,
            locale: 'vi-VN',
            timezoneId: 'Asia/Ho_Chi_Minh',
            permissions: ['geolocation'],
            geolocation: { latitude: 10.7769, longitude: 106.7009 },
            javaScriptEnabled: true,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            extraHTTPHeaders: {
                'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
                'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"'
            },
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--disable-dev-shm-usage',
                '--start-maximized',
                '--lang=vi-VN,vi'
            ]
        });
    } catch (error) {
        console.warn(`⚠️  Failed to launch channel "${browserChannel}": ${error.message.split('\n')[0]}`);
        console.warn('⚠️  Falling back to bundled Chromium. Extensions from Chrome Web Store may not work there.\n');
        context = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            viewport: null,
            locale: 'vi-VN',
            timezoneId: 'Asia/Ho_Chi_Minh',
            permissions: ['geolocation'],
            geolocation: { latitude: 10.7769, longitude: 106.7009 },
            javaScriptEnabled: true,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            extraHTTPHeaders: {
                'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
                'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"'
            },
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--disable-dev-shm-usage',
                '--start-maximized',
                '--lang=vi-VN,vi'
            ]
        });
    }

    // Load cookies nếu có
    if (site) {
        const cookiePath = path.join(__dirname, `.cookies/cookies-${site}.json`);
        if (fs.existsSync(cookiePath)) {
            try {
                const raw = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
                const cookies = Array.isArray(raw) ? raw : (raw.cookies || []);
                const clean = sanitizeCookies(cookies);

                await context.addCookies(clean);
                console.log(`🍪 Loaded ${clean.length} cookies from cookies-${site}.json`);
                console.log(`   Domains: ${[...new Set(clean.map(c => c.domain))].join(', ')}\n`);
            } catch (e) {
                console.warn(`⚠️  Failed to load cookies: ${e.message}\n`);
            }
        } else {
            console.warn(`⚠️  Cookie file not found: .cookies/cookies-${site}.json\n`);
        }
    }

    const page = context.pages()[0] || await context.newPage();

    // Navigate nếu có URL, không thì để trang trắng
    if (startUrl) {
        try {
            console.log(`🔗 Navigating to: ${startUrl}`);
            await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) {
            console.warn(`⚠️  Navigation error: ${e.message.split('\n')[0]}`);
        }
    }

    console.log('✅ Browser is ready. Do your thing!');
    console.log('👉 Press Ctrl+C to close.\n');

    // Giữ process sống cho đến khi bấm Ctrl+C
    await new Promise(() => { });
}

main().catch(console.error);
