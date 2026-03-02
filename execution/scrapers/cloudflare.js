/**
 * Cloudflare Worker Analytics Scraper
 * Uses Cloudflare GraphQL API to fetch worker invocations
 */

const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const CONFIG = require('../config');
const { getTodayVN } = require('../utils/date');

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

    // --- IMPROVED CACHING LOGIC ---
    // Generate a hash of the current stats to detect actual changes
    // This prevents duplicate notifications even if timestamp changes but data is the same
    const generateHash = (data) => {
      return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    };

    const currentHash = generateHash(currentStats);
    const totalRequests = Object.values(currentStats).reduce((acc, s) => acc + s.requests, 0);

    // --- FETCH LATEST TIMESTAMP (for logging purposes) ---
    let latestTimestamp = null;
    try {
      const timestampQuery = `
          query Viewer {
            viewer {
              accounts(filter: {accountTag: "${accountId}"}) {
                workersInvocationsAdaptive(
                  limit: 1,
                  filter: {
                    datetime_geq: "${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}",
                    datetime_leq: "${new Date().toISOString()}"
                  },
                  orderBy: [datetime_DESC]
                ) {
                  dimensions {
                    datetime
                  }
                }
              }
            }
          }
        `;
      const tsResponse = await axios.post(
        'https://api.cloudflare.com/client/v4/graphql',
        { query: timestampQuery },
        {
          headers: {
            'Authorization': `Bearer ${CONFIG.cloudflare.apiToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );

      const tsData = tsResponse.data?.data?.viewer?.accounts[0]?.workersInvocationsAdaptive;
      if (tsData && tsData.length > 0) {
        latestTimestamp = tsData[0].dimensions.datetime;
      }
    } catch (e) {
      console.warn('  ⚠️ Failed to fetch latest timestamp, relying on counts only:', e.message);
    }

    // Load Cache
    let cachedData = {
      hash: null,
      lastSentDate: null,  // YYYY-MM-DD in VN timezone — key field for day-based reset
      timestamp: null,
      totalRequests: 0,
      stats: {}
    };

    if (fs.existsSync(CONFIG.paths.cloudflareCache)) {
      try {
        cachedData = JSON.parse(fs.readFileSync(CONFIG.paths.cloudflareCache, 'utf-8'));
      } catch (e) {
        console.log('  ⚠️ Could not read CF cache, starting fresh.');
      }
    }

    // --- DECISION LOGIC ---
    // "Found at" should use VN timezone for consistency
    const todayVN = getTodayVN(); // e.g. "2026-03-02"
    const isNewDay = cachedData.lastSentDate !== todayVN;
    const isDataChanged = currentHash !== cachedData.hash;

    // Also check if there is actual traffic to report
    const hasTraffic = totalRequests > 0;

    // SEND if:
    //  A) traffic really changed (hash differs) AND there's traffic → always send
    //  B) brand new day AND there's traffic → send once-per-day summary even if same numbers
    // DO NOT send if: same hash + same day (avoids 4h repeated identical notification)
    const shouldNotify = hasTraffic && (isDataChanged || isNewDay);

    console.log(`  📋 Cache check → today: ${todayVN}, lastSentDate: ${cachedData.lastSentDate || 'never'}, hashChanged: ${isDataChanged}, newDay: ${isNewDay}, hasTraffic: ${hasTraffic}`);

    if (shouldNotify) {
      const reason = isDataChanged ? '📈 Traffic changed' : '🗓️ New day — daily summary';
      console.log(`  🔔 Notifying: ${reason}`);
      console.log(`     Data Hash: ${currentHash.substring(0, 12)}... (Old: ${cachedData.hash?.substring(0, 12) || 'none'}...)`);
      console.log(`     Latest TS: ${latestTimestamp || 'N/A'} (Old: ${cachedData.timestamp || 'N/A'})`);
      console.log(`     Requests:  ${totalRequests} (Old: ${cachedData.totalRequests})`);

      let msg = `🌩️ *Cloudflare Workers Report* (24h)\n_Reason: ${reason}_\n`;
      for (const [name, stats] of Object.entries(currentStats)) {
        msg += `\n📦 *${name}*:\n  • Requests: \`${stats.requests}\`\n  • Errors: \`${stats.errors}\``;
      }

      await reporter.sendStatus(msg);

      // Update cache — always record the date we last sent
      const newCache = {
        hash: currentHash,
        lastSentDate: todayVN,
        timestamp: latestTimestamp || new Date().toISOString(),
        totalRequests,
        stats: currentStats
      };
      fs.writeFileSync(CONFIG.paths.cloudflareCache, JSON.stringify(newCache, null, 2));
      console.log(`  ✅ Cache updated (hash + lastSentDate → ${todayVN}).`);
    } else if (!hasTraffic) {
      console.log('  💤 No traffic in last 24h. Skipping notification.');
    } else {
      // Same hash AND same day → absolute skip
      console.log(`  💤 Cloudflare data unchanged and already reported today (${todayVN}). Skipping.`);
    }

  } catch (e) {
    console.error(`  ❌ Cloudflare API Error: ${e.message}`);
    // Optional: Send error report if critical
  }
}

module.exports = { scrapeCloudflare };
