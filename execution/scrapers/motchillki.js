/**
 * Motchillki Scraper - Jujutsu Kaisen Checker
 */

const CONFIG = require('../config');
const { humanScroll } = require('../lib/stealth');

async function scrapeMotchillki(page, reporter, testOptions = {}) {
    console.log('🎬 Checking Motchillki for Jujutsu Kaisen...');
    if (testOptions.lastSeenEp) {
        console.log(`  🧪 Test Mode: Forcing Last Seen Ep = ${testOptions.lastSeenEp}`);
    }

    // User's specific URL or list logic
    // User gave: https://motchillki.fm/phim/chu-thuat-hoi-chien-phan-3/tap-5-sv-0
    // We'll use the generic episode list page if possible, but visiting any episode page works if the list is there.
    const showUrl = 'https://motchillki.fm/phim/chu-thuat-hoi-chien-phan-3/tap-5-sv-0';

    try {
        await page.goto(showUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Wait for list to be visible seems prudent
        try {
            await page.waitForSelector('.list-episode', { timeout: 10000 });
        } catch (e) {
            console.log('  ⚠️ .list-episode not found immediately.');
        }

        const title = await page.title();
        console.log(`  📄 Page Title: ${title}`);

        // Scrape Episode List
        const episodes = [];
        const episodeLinks = await page.locator('.list-episode a').all();
        console.log(`  📦 Found ${episodeLinks.length} items in episode list`);

        for (const link of episodeLinks) {
            const text = await link.innerText().catch(() => '');
            const href = await link.getAttribute('href').catch(() => '');

            // Text is just "1", "2", "3", "4", "5"
            // We parse strictly
            const epNum = parseInt(text.trim());
            if (!isNaN(epNum)) {
                episodes.push(epNum);
            } else {
                // Fallback: extract from href if text is weird? 
                // e.g. .../tap-5-sv-0
                const match = href.match(/tap-(\d+)-sv/);
                if (match) {
                    episodes.push(parseInt(match[1]));
                }
            }
        }

        const maxEp = episodes.length > 0 ? Math.max(...episodes) : 0;
        console.log(`  🔍 Max Episode Found: ${maxEp}`);

        const fs = require('fs');
        const path = require('path');

        // Cache File Path (Updated to motchillki)
        const cachePath = path.join(CONFIG.paths.logs, 'motchillki-cache.json');

        // 1. Read Cache or Default
        let lastSeenEp = 5; // User baseline

        if (testOptions.lastSeenEp !== undefined) {
            lastSeenEp = testOptions.lastSeenEp;
        } else if (fs.existsSync(cachePath)) {
            try {
                const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
                if (cache.lastSeenEp && typeof cache.lastSeenEp === 'number') {
                    lastSeenEp = cache.lastSeenEp;
                }
            } catch (e) {
                console.warn('  ⚠️ Failed to read Motchillki cache, using default.');
            }
        }

        console.log(`  🎬 Last Seen Episode (Cache/Test): ${lastSeenEp}`);

        if (maxEp > lastSeenEp) {
            console.log(`  🎉 New Episode Detected: ${maxEp}`);
            await reporter.sendStatus(`🎬 Anime Update: Jujutsu Kaisen có tập mới trên Motchillki! (Tập ${maxEp}) > Tập ${lastSeenEp}\n🔗 ${showUrl}`);

            // 2. Update Cache
            if (!testOptions.dryRun) {
                try {
                    fs.writeFileSync(cachePath, JSON.stringify({ lastSeenEp: maxEp, updated: new Date().toISOString() }, null, 2));
                    console.log(`  💾 Updated Motchillki cache to Ep ${maxEp}`);
                } catch (e) {
                    console.error('  ❌ Failed to update Motchillki cache:', e);
                }
            } else {
                console.log(`  🧪 Test Mode: Cache update SKIPPED`);
            }

        } else {
            console.log(`  ℹ️ No new episodes. Max is ${maxEp} (Last seen: ${lastSeenEp}).`);
        }

    } catch (e) {
        console.error(`  ❌ Motchillki Error: ${e.message}`);
    }
}

module.exports = { scrapeMotchillki };

