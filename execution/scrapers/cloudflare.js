/**
 * Cloudflare Worker Analytics Scraper
 * Uses Cloudflare GraphQL API to fetch worker invocations
 */

const axios = require('axios');
const fs = require('fs');
const CONFIG = require('../config');

async function scrapeCloudflare(reporter) {
    if (!CONFIG.cloudflare.apiToken) {
        console.log('  ⚠️ CLOUDFLARE_API_TOKEN not found in env. Skipping...');
        return;
    }

    console.log('🌩️ Checking Cloudflare Worker Analytics...');

    const accountId = CONFIG.cloudflare.accountId;
    // Query for last 24 hours of worker invocations
    // We group by scriptName to see which worker is getting hit
    const query = `
      query Viewer {
        viewer {
          accounts(filter: {accountTag: "${accountId}"}) {
            workersInvocationsAdaptive(
              limit: 10,
              filter: {
                datetime_geq: "${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}",
                datetime_leq: "${new Date().toISOString()}"
              }
            ) {
              sum {
                requests
                errors
              }
              dimensions {
                scriptName
              }
            }
          }
        }
      }
    `;

    try {
        const response = await axios.post(
            'https://api.cloudflare.com/client/v4/graphql',
            { query },
            {
                headers: {
                    'Authorization': `Bearer ${CONFIG.cloudflare.apiToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000 // 10s timeout
            }
        );

        if (response.data.errors) {
            throw new Error(JSON.stringify(response.data.errors));
        }

        const data = response.data.data.viewer.accounts[0].workersInvocationsAdaptive;

        if (!data || data.length === 0) {
            console.log('  ℹ️ No Cloudflare Worker traffic in last 24h.');
            return;
        }

        // Aggregate stats
        // Structure: "scriptName": { requests: 10, errors: 0 }
        let currentStats = {};

        data.forEach(item => {
            const name = item.dimensions.scriptName;
            const requests = item.sum.requests;
            const errors = item.sum.errors;
            currentStats[name] = { requests, errors };
        });

        console.log('  📊 Current Cloudflare Stats:', JSON.stringify(currentStats, null, 2));

        // Load Cache
        let cachedStats = {};
        if (fs.existsSync(CONFIG.paths.cloudflareCache)) {
            try {
                cachedStats = JSON.parse(fs.readFileSync(CONFIG.paths.cloudflareCache, 'utf-8'));
            } catch (e) {
                console.log('  ⚠️ Could not read CF cache, starting fresh.');
            }
        }

        // Compare
        const isDifferent = JSON.stringify(currentStats) !== JSON.stringify(cachedStats);

        if (isDifferent) {
            // Check if any worker has significant traffic (> 0) to avoid noisy notifications for 0
            const hasTraffic = Object.values(currentStats).some(s => s.requests > 0);

            if (hasTraffic) {
                console.log('  🔔 Cloudflare stats changed. Sending notification.');

                let msg = '🌩️ *Cloudflare Workers Report* (24h)\n';
                for (const [name, stats] of Object.entries(currentStats)) {
                    msg += `\n📦 *${name}*:\n  • Requests: \`${stats.requests}\`\n  • Errors: \`${stats.errors}\``;
                }

                await reporter.sendStatus(msg);

                // Update Cache
                fs.writeFileSync(CONFIG.paths.cloudflareCache, JSON.stringify(currentStats, null, 2));
            } else {
                console.log('  💤 No significant traffic (all zeros). Skipping notification.');
            }
        } else {
            console.log('  💤 Cloudflare stats identical to cache. Skipping.');
        }

    } catch (e) {
        console.error(`  ❌ Cloudflare API Error: ${e.message}`);
        // Optional: Send error report if critical
    }
}

module.exports = { scrapeCloudflare };
