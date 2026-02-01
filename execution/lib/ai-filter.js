/**
 * AI Job Filter - Gemini + Regex Fallback
 * 
 * Priority:
 * 1. Gemini (if GEMINI_API_KEY set) - free tier 15 req/min
 * 2. Regex fallback (always works)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const CONFIG = require('../config');

// Initialize Gemini if API key available
const geminiApiKey = process.env.GEMINI_API_KEY;
let gemini = null;
if (geminiApiKey) {
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    gemini = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
}

/**
 * Batch validate ALL jobs from ALL platforms with ONE API call
 */
async function batchValidateJobsWithAI(jobs) {
    const results = new Map();

    // Regex fallback function
    const regexValidate = (job) => {
        const text = `${job.title} ${job.description || ''} ${job.company || ''}`.toLowerCase();
        const source = (job.source || '').toLowerCase();

        // LinkedIn posts - already filtered by scraper, trust the score
        if (source.includes('linkedin')) {
            // Jobs already passed scraper filter with score 8 - trust them
            return {
                isValid: true,
                score: job.matchScore || 8,
                reason: 'linkedin-pre-filtered'
            };
        }

        // Twitter/TopCV - strict golang requirement
        const hiringPatterns = /\b(is hiring|we're hiring|now hiring|#hiring|job opening|open position|hiring for|recruiting|apply now|hiring!|new.+job|remote job|looking for|we need|developer needed)\b/i;
        const personalPatterns = /\b(i need|i('m| am) looking|i want|my job|just asking|can't hate|first guy|if you're a)\b/i;
        const golangPatterns = /\b(golang|go\s*developer|go\s*backend|go\s*engineer|go\s*programming)\b/i;

        const isHiring = hiringPatterns.test(text) && !personalPatterns.test(text);
        const hasGolang = golangPatterns.test(text);

        let score = 3;
        if (isHiring) score += 3;
        if (hasGolang) score += 3;
        if (isHiring && hasGolang) score = 8;

        return {
            isValid: score >= 6,
            score: Math.min(10, score),
            reason: 'regex'
        };
    };

    if (!jobs || jobs.length === 0) {
        return results;
    }

    console.log(`\n🤖 AI Validation: Processing ${jobs.length} jobs...`);

    // Try Gemini if available
    if (gemini) {
        try {
            console.log('  📤 Sending batch to Gemini AI...');

            const jobList = jobs.map((job, i) =>
                `[${i}] ${job.source}: ${job.title?.slice(0, 60)} | ${job.description?.slice(0, 80) || 'N/A'}`
            ).join('\n');

            const prompt = `Analyze these ${jobs.length} job posts. Determine if each is a REAL JOB POSTING (company hiring for Golang/Go developer) or NOT.

${jobList}

Respond with JSON array ONLY:
[{"id": 0, "isValid": true, "score": 7, "reason": "golang hiring"}]

Score: 8-10=clear job, 5-7=possible, 1-4=not a job`;

            const result = await gemini.generateContent(prompt);
            const responseText = result.response.text();

            const jsonMatch = responseText.match(/\[[\s\S]*?\]/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                for (const item of parsed) {
                    const idx = parseInt(item.id);
                    if (idx >= 0 && idx < jobs.length) {
                        results.set(jobs[idx].id, {
                            isValid: item.isValid === true,
                            score: Math.min(10, Math.max(1, parseInt(item.score) || 5)),
                            reason: item.reason || 'AI'
                        });
                    }
                }
                console.log(`  ✅ Gemini validated ${results.size}/${jobs.length} jobs`);
            }
        } catch (error) {
            const errorMsg = error.message?.slice(0, 80) || 'Unknown error';
            if (errorMsg.includes('429') || errorMsg.includes('RATE_LIMIT')) {
                console.log('  ⚠️ Gemini rate limit hit, using regex fallback');
            } else {
                console.log(`  ⚠️ Gemini error: ${errorMsg}`);
            }
            console.log('  🔧 Falling back to regex validation');
        }
    } else {
        console.log('  🔧 Using regex validation (no GEMINI_API_KEY)');
    }

    // Fill missing with regex fallback
    for (const job of jobs) {
        if (!results.has(job.id)) {
            results.set(job.id, regexValidate(job));
        }
    }

    // Summary
    const validCount = [...results.values()].filter(r => r.isValid).length;
    const aiCount = [...results.values()].filter(r => r.reason !== 'regex').length;
    console.log(`  📊 Result: ${validCount}/${jobs.length} valid (${aiCount} AI, ${jobs.length - aiCount} regex)`);

    return results;
}

module.exports = { batchValidateJobsWithAI };
