/**
 * X (Twitter) Scraper
 * Returns raw tweet data - AI validation done in main.js
 */

const CONFIG = require('../config');
const { randomDelay, humanScroll } = require('../lib/stealth');
const { analyzeLocation, calculateMatchScore, hasExplicitNonPreferredLocation } = require('../lib/filters');
const ScreenshotDebugger = require('../lib/screenshot');

/**
 * Helper: Normalize text to handle fancy fonts and accents
 */
const normalizeText = (text) => (text || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function cleanLocationValue(value) {
    return (value || '')
        .replace(/^[\s:,-]+|[\s:,-]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractLocation(text) {
    const locationInfo = analyzeLocation(text);
    if (locationInfo.preferredLocation !== 'Unknown' && locationInfo.preferredLocation !== 'Hanoi') {
        return locationInfo.preferredLocation;
    }
    if (locationInfo.isHanoiOnly) {
        return 'Hanoi';
    }

    const taggedMatch = text.match(/[📍📌]\s*([^\n|•]{2,80})/u);
    if (taggedMatch) {
        return cleanLocationValue(taggedMatch[1]);
    }

    const explicitLine = (text || '')
        .split('\n')
        .map(line => line.trim())
        .find(line => /^(location|dia diem|địa điểm|based in|onsite in|hybrid in|work location)\b/i.test(line));

    if (!explicitLine) return 'Unknown';

    const normalizedLine = explicitLine.replace(/^(location|dia diem|địa điểm|based in|onsite in|hybrid in|work location)\b/i, '');
    return cleanLocationValue(normalizedLine);
}

/**
 * Scrape jobs from X (Twitter)
 * Returns RAW jobs - AI validation done centrally in main.js
 */
async function scrapeTwitter(page, reporter) {
    console.log('🐦 Searching X (Twitter)...');

    const jobs = [];
    const seenUrls = new Set();
    const screenshotDebugger = new ScreenshotDebugger(reporter);
    const warnings = [];

    const baseKeywords = CONFIG.socialSearchKeywords?.length > 0
        ? CONFIG.socialSearchKeywords
        : CONFIG.keywords;
    const searchQueries = baseKeywords.map(keyword => `"${keyword}" (job OR hiring OR opening OR recruiter OR careers OR apply)`);

    try {
        for (const searchQuery of searchQueries) {
            console.log(`  🔍 Query: ${searchQuery.slice(0, 80)}...`);

            await page.goto(`https://x.com/search?q=${encodeURIComponent(searchQuery)}&f=live`,
                { waitUntil: 'domcontentloaded', timeout: 60000 });
            await randomDelay(1000, 2000);

            await page.waitForSelector('[data-testid="tweet"]', { timeout: 10000 }).catch(() => { });

            // Check for login wall
            if (await page.locator('[data-testid="LoginForm"]').count() > 0) {
                console.log('  ⚠️ Twitter requires login, skipping...');
                await screenshotDebugger.captureAuthIssue(page, 'twitter', 'X requires login or cookies have expired');
                await reporter.sendStatus('⚠️ X requires login - skipping (ensure cookies are valid)');
                warnings.push('Login wall detected on X');
                return {
                    jobs,
                    status: 'blocked',
                    warnings,
                    metrics: {
                        scannedCount: seenUrls.size
                    }
                };
            }

            await humanScroll(page);

            const tweetElements = await page.locator('[data-testid="tweet"]').all();
            console.log(`  📦 Found ${tweetElements.length} tweets`);

            // Collect raw tweet data - NO AI validation here
            for (let i = 0; i < Math.min(tweetElements.length, 30); i++) {
                try {
                    const tweet = tweetElements[i];
                    const text = await tweet.locator('[data-testid="tweetText"]').textContent().catch(() => null);
                    if (!text || text.trim().length < 20) continue;

                    const authorHandle = await tweet.locator('[data-testid="User-Name"] a').first().getAttribute('href').catch(() => null);
                    const tweetLink = await tweet.locator('a[href*="/status/"]').first().getAttribute('href').catch(() => null);
                    const timeEl = await tweet.locator('time').first();
                    const dateTime = await timeEl.getAttribute('datetime').catch(() => null);
                    const url = tweetLink ? `https://x.com${tweetLink}` : 'https://x.com';
                    if (seenUrls.has(url)) continue;
                    const location = extractLocation(text);
                    const locationInfo = analyzeLocation(`${location} ${text}`);
                    if (locationInfo.isHanoiOnly || hasExplicitNonPreferredLocation(location)) continue;

                    // Build raw job object
                    const job = {
                        title: text?.slice(0, 100)?.trim() + '...',
                        description: text,
                        company: authorHandle?.replace('/', '') || 'Twitter Post',
                        url: url,
                        location,
                        source: 'X (Twitter)',
                        techStack: 'Go/Golang',
                        postedDate: dateTime ? new Date(dateTime).toISOString().split('T')[0] : 'N/A',
                        matchScore: 5
                    };

                    // Basic filter - only include if has job-related keywords
                    const textNorm = normalizeText(text);

                    if (/\b(hiring|job|opening|developer|engineer|position|remote|golang|go backend|go developer|backend role)\b/i.test(textNorm)) {
                        job.matchScore = calculateMatchScore(job);
                        jobs.push(job);
                        seenUrls.add(url);
                        console.log(`    📝 ${job.title.slice(0, 40)}...`);
                    }
                } catch (e) {
                    // Skip malformed
                }
            }
        }

        console.log(`  📊 Collected ${jobs.length} tweets for unified AI validation`);

    } catch (error) {
        console.error('Error searching Twitter:', error.message);
        await screenshotDebugger.captureError(page, 'twitter', error);
        await reporter.sendError(`Twitter search failed: ${error.message}`);
        return {
            jobs,
            status: 'failed',
            warnings: [`Twitter search failed: ${error.message}`],
            error: error.message,
            metrics: {
                scannedCount: seenUrls.size
            }
        };
    }

    return {
        jobs,
        status: warnings.length > 0 ? 'partial' : 'success',
        warnings,
        metrics: {
            scannedCount: seenUrls.size
        }
    };
}

module.exports = { scrapeTwitter };
