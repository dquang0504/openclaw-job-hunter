/**
 * Gemini AI Job Filter - Batch validation
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const CONFIG = require('../config');

// Initialize Gemini AI (optional)
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

/**
 * Batch validate multiple tweets with ONE Gemini API call
 * @param {Array<{id: number, text: string}>} tweets
 * @returns {Map<number, {isJob: boolean, score: number, reason: string}>}
 */
async function batchValidateJobsWithAI(tweets) {
    const results = new Map();

    // Fallback function using regex
    const regexValidate = (text) => {
        const hiringPatterns = /\b(is hiring|we're hiring|now hiring|#hiring|job opening|open position|hiring for|recruiting|apply now|hiring!|new.+job|remote job|job.+remote)\b/i;
        const personalPatterns = /\b(i need|i('m| am) looking|i want|my job|just asking|can't hate|first guy|if you're a)\b/i;
        const isJob = hiringPatterns.test(text) && !personalPatterns.test(text);
        return { isJob, score: isJob ? 7 : 3, reason: 'regex' };
    };

    // If no AI, use regex for all
    if (!genAI) {
        console.log('  🔧 Using regex validation (no AI key)');
        for (const t of tweets) {
            results.set(t.id, regexValidate(t.text));
        }
        return results;
    }

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        // Build batch prompt
        const tweetList = tweets.map((t, i) => `[${i}] "${t.text.slice(0, 200)}"`).join('\n\n');

        const prompt = `Analyze these ${tweets.length} tweets. For EACH, determine if it's a REAL JOB POSTING (company hiring) or NOT (personal, question, sharing).

${tweetList}

Respond with ONLY a JSON array (no markdown, no explanation):
[{"id": 0, "isJob": true/false, "score": 1-10, "reason": "brief"}]

Score guide:
- 8-10: Clear job posting (company hiring, has role)
- 5-7: Likely job-related
- 1-4: NOT a job (personal seeking, question, sharing)`;

        console.log('  🤖 Sending batch to Gemini AI...');
        const result = await model.generateContent(prompt);
        const response = result.response.text().trim();

        // Parse JSON array response
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            for (const item of parsed) {
                const idx = parseInt(item.id);
                if (idx >= 0 && idx < tweets.length) {
                    results.set(tweets[idx].id, {
                        isJob: item.isJob === true,
                        score: Math.min(10, Math.max(1, parseInt(item.score) || 5)),
                        reason: item.reason || 'AI'
                    });
                }
            }
            console.log(`  ✅ AI processed ${results.size} tweets`);
        }
    } catch (error) {
        console.log('⚠️ AI batch failed, using regex:', error.message.slice(0, 100));
    }

    // Fill in any missing with regex fallback
    for (const t of tweets) {
        if (!results.has(t.id)) {
            results.set(t.id, regexValidate(t.text));
        }
    }

    return results;
}

module.exports = { batchValidateJobsWithAI, genAI };
