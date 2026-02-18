/**
 * AI Job Filter - Groq (Llama 3) + Regex Fallback
 * 
 * Priority:
 * 1. Groq (if GROQ_API_KEY set) - fast & accurate
 * 2. Regex fallback (always works)
 */

const Groq = require('groq-sdk');
const CONFIG = require('../config');

// Initialize Groq if API key available
const groqApiKey = process.env.GROQ_API_KEY;
let groq = null;
if (groqApiKey) {
    groq = new Groq({ apiKey: groqApiKey });
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

    // Try Groq if available
    if (groq) {
        try {
            console.log('  📤 Sending batch to Groq (Llama3-70b)...');

            const jobList = jobs.map((job, i) =>
                `[ID:${i}] SOURCE: ${job.source} | TITLE: ${job.title?.slice(0, 80)} | DESC: ${job.description?.slice(0, 150) || 'N/A'}`
            ).join('\n');

            const systemPrompt = `You are an expert Job Hunter AI.
Your task is to analyze a list of job postings and filter for REAL Golang/Go software development jobs.

Rules:
1. Identify if it is a REAL Job Posting (Hiring) or just a discussion/spam.
2. Ensure it is related to GOLANG (Go language).
3. Score from 1-10 (10 = Perfect Golang Job match, 1 = Spam/Irrelevant).
4. Extract key details: Location (CHECK DESCRIPTION CAREFULLY. If metadata says 'Remote' but description says 'Hanoi', use 'Hanoi'), Posted Date (convert relative to absolute if possible, or keep as is), Tech Stack.
5. Ignore "looking for job" posts (candidates asking for work).
6. CRITICAL: If the job requires more than 2 years of experience (e.g. 3+, 3-5 years, Senior), mark isValid=false or score=1. We are looking for Fresher/Junior/Mid (<2 YOE) only.

Output JSON ARRAY ONLY. No markdown, no text.
Format:
[{"id": 0, "isValid": true, "score": 9, "reason": "Clear golang hiring", "location": "Remote", "postedDate": "2024-02-01", "techStack": "Go, AWS"}]`;

            const completion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: jobList }
                ],
                model: "llama-3.3-70b-versatile",
                temperature: 0.1,
                response_format: { type: "json_object" }
            });

            const responseText = completion.choices[0]?.message?.content;

            // Groq usually returns an object if response_format is json_object, but we need an array.
            // Sometimes it wraps in { "jobs": [...] } or just [...]
            // Let's safe parse.
            let parsed = [];
            try {
                const json = JSON.parse(responseText);
                if (Array.isArray(json)) {
                    parsed = json;
                } else if (json.jobs && Array.isArray(json.jobs)) {
                    parsed = json.jobs;
                } else {
                    // Try to find array in keys
                    const key = Object.keys(json).find(k => Array.isArray(json[k]));
                    if (key) parsed = json[key];
                }
            } catch (e) {
                console.warn("Retrying JSON parse with regex...");
                const match = responseText.match(/\[[\s\S]*\]/);
                if (match) parsed = JSON.parse(match[0]);
            }

            for (const item of parsed) {
                const idx = parseInt(item.id);
                if (idx >= 0 && idx < jobs.length) {
                    results.set(jobs[idx].id, {
                        isValid: item.isValid === true,
                        score: Math.min(10, Math.max(1, parseInt(item.score) || 5)),
                        reason: item.reason || 'AI',
                        location: item.location,
                        postedDate: item.postedDate,
                        techStack: item.techStack
                    });
                }
            }
            console.log(`  ✅ Groq validated ${results.size}/${jobs.length} jobs`);

        } catch (error) {
            console.log(`  ⚠️ Groq Error: ${error.message}`);
            console.log('  🔧 Falling back to regex validation');
        }
    } else {
        console.log('  🔧 Using regex validation (no GROQ_API_KEY)');
    }

    // Fill missing with regex fallback
    for (const job of jobs) {
        if (!results.has(job.id)) {
            results.set(job.id, regexValidate(job));
        }
    }

    // Summary
    const validCount = [...results.values()].filter(r => r.isValid).length;
    const aiCount = [...results.values()].filter(r => r.reason === 'AI' || (r.reason && !r.reason.includes('regex'))).length;

    console.log(`  📊 Result: ${validCount}/${jobs.length} valid (AI/Trusted: ${aiCount})`);

    return results;
}

module.exports = { batchValidateJobsWithAI };
