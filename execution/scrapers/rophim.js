/**
 * Rophim Scraper - Jujutsu Kaisen Checker
 */

const CONFIG = require('../config');
const { humanScroll } = require('../lib/stealth');

async function scrapeRophim(page, reporter) {
    console.log('🎬 Checking Rophim for Jujutsu Kaisen...');

    // User's specific URL
    const showUrl = 'https://www.rophim.la/xem-phim/chu-thuat-hoi-chien.4lufRzSV?ver=1&ss=3&ep=5';

    try {
        await page.goto(showUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Wait for JS to render episode list
        await page.waitForTimeout(3000);

        const title = await page.title();
        console.log(`  📄 Page Title: ${title}`);

        // Try to identify episode list container
        const possibleContainers = ['.list-episode', '#list-episode', '.halim-list-eps', '.episodes', 'ul.list-chap', '.server-list'];
        let container = null;

        for (const sel of possibleContainers) {
            if (await page.locator(sel).count() > 0) {
                container = page.locator(sel).first();
                console.log(`  found episode container: ${sel}`);
                break;
            }
        }

        // If container found, get all links inside
        let links = [];
        if (container) {
            links = await container.locator('a').all();
        } else {
            // Fallback: get text matching "Tập X"
            console.log('  ⚠️ No specific container found, searching all "Tập" links');
            links = await page.locator('a:has-text("Tập"), a:has-text("EP")').all();
        }

        console.log(`  📦 Potential Episode Links found: ${links.length}`);

        let maxEp = 0;

        for (const link of links) {
            const href = await link.getAttribute('href').catch(() => '');
            const text = await link.innerText().catch(() => '');

            // Clean text
            const cleanText = text.replace(/\n/g, ' ').trim();

            // Try extracting from href first: ...&ep=6 or /tap-6
            let match = href.match(/ep=(\d+)/) || href.match(/tap-(\d+)/);
            if (match) {
                const epNum = parseInt(match[1]);
                if (epNum > maxEp) maxEp = epNum;
            } else {
                // Try text: "Tập 6" or just "6"
                const matchText = cleanText.match(/(\d+)/);
                if (matchText) {
                    const epNum = parseInt(matchText[0]);
                    // Sanity check: episode shouldn't be like 2024 (year)
                    if (epNum < 1000 && epNum > maxEp) maxEp = epNum;
                }
            }
        }

        console.log(`  🔍 Max Episode Found: ${maxEp}`);


        const fs = require('fs');
        const path = require('path');

        // Cache File Path
        const cachePath = path.join(CONFIG.paths.logs, 'rophim-cache.json');

        // 1. Read Cache or Default
        let lastSeenEp = 5; // Default baseline

        if (fs.existsSync(cachePath)) {
            try {
                const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
                if (cache.lastSeenEp && typeof cache.lastSeenEp === 'number') {
                    lastSeenEp = cache.lastSeenEp;
                }
            } catch (e) {
                console.warn('  ⚠️ Failed to read Rophim cache, using default.');
            }
        }

        console.log(`  🎬 Last Seen Episode (Cache): ${lastSeenEp}`);

        if (maxEp > lastSeenEp) {
            console.log(`  🎉 New Episode Detected: ${maxEp}`);
            await reporter.sendStatus(`🎬 Anime Update: Jujutsu Kaisen có tập mới! (Tập ${maxEp}) > Tập ${lastSeenEp}`);

            // 2. Update Cache Immediately
            try {
                fs.writeFileSync(cachePath, JSON.stringify({ lastSeenEp: maxEp, updated: new Date().toISOString() }, null, 2));
                console.log(`  💾 Updated Rophim cache to Ep ${maxEp}`);
            } catch (e) {
                console.error('  ❌ Failed to update Rophim cache:', e);
            }

        } else {
            console.log(`  ℹ️ No new episodes. Max is ${maxEp} (Last seen: ${lastSeenEp}).`);
        }

    } catch (e) {
        console.error(`  ❌ Rophim Error: ${e.message}`);
    }
}

module.exports = { scrapeRophim };
