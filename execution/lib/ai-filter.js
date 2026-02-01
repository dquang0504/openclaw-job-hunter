/**
 * AI Job Filter using G4F (gpt4free) via REST API
 * 
 * Features:
 * - Uses G4F API for free AI access (no API key required)
 * - Batch validation for all jobs from all platforms in ONE call
 * - Falls back to regex if G4F fails
 */

const CONFIG = require('../config');

// G4F API endpoint - uses free providers
const G4F_API_URL = 'https://api.g4f.dev/chat/completions';

/**
 * Batch validate ALL jobs from ALL platforms with ONE G4F API call
 * @param {Array<{id: string, title: string, description: string, source: string}>} jobs
 * @returns {Map<string, {isValid: boolean, score: number, reason: string}>}
 */
async function batchValidateJobsWithAI(jobs) {
    const results = new Map();

    // Fallback function using regex
    const regexValidate = (job) => {
        const text = `${job.title} ${job.description || ''} ${job.company || ''}`.toLowerCase();

        const hiringPatterns = /\b(is hiring|we're hiring|now hiring|#hiring|job opening|open position|hiring for|recruiting|apply now|hiring!|new.+job|remote job|looking for|we need)\b/i;
        const personalPatterns = /\b(i need|i('m| am) looking|i want|my job|just asking|can't hate|first guy|if you're a)\b/i;
        const golangPatterns = /\b(golang|go\s+developer|go\s+backend|go\s+engineer)\b/i;

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

    // If no jobs, return empty
    if (!jobs || jobs.length === 0) {
        return results;
    }

    console.log(`\n🤖 AI Validation: Processing ${jobs.length} jobs from all platforms...`);

    try {
        // Build batch prompt with all jobs
        const jobList = jobs.map((job, i) =>
            `[${i}] Source: ${job.source}\nTitle: ${job.title?.slice(0, 80)}\nContent: ${job.description?.slice(0, 120) || 'N/A'}`
        ).join('\n\n');

        const prompt = `Analyze these ${jobs.length} job posts. For each, determine if it's a REAL JOB POSTING (company hiring) or NOT (personal post, question, etc.). Focus on Golang/Go positions.

${jobList}

Respond with ONLY a JSON array:
[{"id": 0, "isValid": true, "score": 7, "reason": "hiring post"}]

Score: 8-10 real job, 5-7 possible, 1-4 not job.`;

        console.log('  📤 Sending batch to G4F API...');

        const response = await fetch(G4F_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are a job validator. Respond only with valid JSON array.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 1000
            }),
            timeout: 30000
        });

        if (!response.ok) {
            throw new Error(`G4F API error: ${response.status}`);
        }

        const data = await response.json();
        const responseText = data.choices?.[0]?.message?.content || '';

        console.log('  📥 Received response from G4F');

        // Extract JSON array from response
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
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
            console.log(`  ✅ AI validated ${results.size}/${jobs.length} jobs`);
        }
    } catch (error) {
        console.log(`  ⚠️ G4F API failed: ${error.message?.slice(0, 60)}`);
        console.log('  🔧 Using regex fallback for all jobs');
    }

    // Fill in any missing with regex fallback
    for (const job of jobs) {
        if (!results.has(job.id)) {
            results.set(job.id, regexValidate(job));
        }
    }

    // Log summary
    const validCount = [...results.values()].filter(r => r.isValid).length;
    console.log(`  📊 Result: ${validCount}/${jobs.length} jobs validated as real job posts`);

    return results;
}

/**
 * Simple regex validation for single job (no AI)
 */
function regexValidateJob(job) {
    const text = `${job.title} ${job.description || ''} ${job.company || ''}`.toLowerCase();

    const golangPatterns = /\b(golang|go\s+developer|go\s+backend)\b/i;
    const hasGolang = golangPatterns.test(text);

    if (!hasGolang) return { isValid: false, score: 3, reason: 'no golang' };
    if (CONFIG.excludeRegex.test(text)) return { isValid: false, score: 2, reason: 'excluded' };

    return { isValid: true, score: 6, reason: 'regex match' };
}

module.exports = { batchValidateJobsWithAI, regexValidateJob };
