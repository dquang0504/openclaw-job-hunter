const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const seeds = require('../models/social-hiring-seeds');

const OPENCLAW_ROOT = path.join(__dirname, '..', '..');
const PYTHON_BIN = process.env.SOCIAL_HIRING_PYTHON || 'python3';
const PREDICT_SCRIPT = process.env.SOCIAL_HIRING_PREDICT_SCRIPT
    || path.join(OPENCLAW_ROOT, 'execution', 'python', 'social_hiring_predict.py');

let fastTextProbe = null;

function normalize(text) {
    return (text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function tokenize(text) {
    return normalize(text)
        .replace(/[^a-z0-9@.+#\s-]/g, ' ')
        .split(/\s+/)
        .filter(token => token.length >= 2);
}

function extractFeatures(text) {
    const tokens = tokenize(text);
    const features = [...tokens];

    for (let i = 0; i < tokens.length - 1; i++) {
        features.push(`${tokens[i]}__${tokens[i + 1]}`);
    }

    const normalized = normalize(text);
    if (/@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) features.push('__has_email__');
    if (/\b(cv|resume|apply|inbox)\b/i.test(normalized)) features.push('__has_apply_signal__');
    if (/\b\d{1,3}\s?(tr|m|usd|vnd|vnđ)\b/i.test(normalized)) features.push('__has_salary__');
    if (/\b(remote|hcm|ho chi minh|can tho|worldwide|global)\b/i.test(normalized)) features.push('__has_location__');
    if (/\b(golang|go backend|go developer|go engineer)\b/i.test(normalized)) features.push('__has_go_role__');
    if (/\b(open to work|my cv|hire me|my pick|tutorial|roadmap|showcase|side project)\b/i.test(normalized)) {
        features.push('__negative_pattern__');
    }

    return features;
}

function buildModel() {
    const classDocs = {
        hiring: seeds.positive,
        non_hiring: seeds.negative
    };

    const docCounts = {};
    const tokenTotals = {};
    const tokenCounts = {};
    const vocabulary = new Set();

    for (const [label, docs] of Object.entries(classDocs)) {
        docCounts[label] = docs.length;
        tokenTotals[label] = 0;
        tokenCounts[label] = new Map();

        for (const doc of docs) {
            const features = extractFeatures(doc);
            for (const feature of features) {
                vocabulary.add(feature);
                tokenTotals[label] += 1;
                tokenCounts[label].set(feature, (tokenCounts[label].get(feature) || 0) + 1);
            }
        }
    }

    const totalDocs = Object.values(docCounts).reduce((sum, count) => sum + count, 0);
    return {
        docCounts,
        tokenTotals,
        tokenCounts,
        vocabularySize: vocabulary.size,
        totalDocs
    };
}

const model = buildModel();

function scoreLabel(label, features) {
    const prior = Math.log(model.docCounts[label] / model.totalDocs);
    const denom = model.tokenTotals[label] + model.vocabularySize;

    let score = prior;
    for (const feature of features) {
        const count = model.tokenCounts[label].get(feature) || 0;
        score += Math.log((count + 1) / denom);
    }

    return score;
}

function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

function hasFastTextRuntime() {
    if (fastTextProbe !== null) return fastTextProbe;

    fastTextProbe = fs.existsSync(PREDICT_SCRIPT);
    return fastTextProbe;
}

function classifyWithSeedModel(text) {
    const features = extractFeatures(text);
    if (features.length === 0) {
        return {
            label: 'non_hiring',
            isHiring: false,
            confidence: 0.5,
            margin: 0,
            source: 'seed'
        };
    }

    const hiringScore = scoreLabel('hiring', features);
    const nonHiringScore = scoreLabel('non_hiring', features);
    const margin = hiringScore - nonHiringScore;
    const confidence = sigmoid(Math.abs(margin));
    const isHiring = margin > 0;

    return {
        label: isHiring ? 'hiring' : 'non_hiring',
        isHiring,
        confidence,
        margin,
        source: 'seed'
    };
}

function classifyWithFastText(text) {
    if (!hasFastTextRuntime()) return null;

    try {
        const raw = execFileSync(
            PYTHON_BIN,
            [PREDICT_SCRIPT],
            {
                cwd: OPENCLAW_ROOT,
                env: {
                    ...process.env,
                    OPENCLAW_ROOT
                },
                input: JSON.stringify({ text }),
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore'],
                timeout: 2500,
                maxBuffer: 1024 * 1024
            }
        ).trim();

        if (!raw) return null;
        const result = JSON.parse(raw);
        if (!result || !result.label) return null;

        return {
            label: result.label,
            isHiring: result.label === 'hiring',
            confidence: Number(result.confidence) || 0.5,
            margin: Number(result.margin) || 0,
            source: 'fasttext'
        };
    } catch (error) {
        return null;
    }
}

function classifySocialHiringPost(text) {
    return classifyWithFastText(text) || classifyWithSeedModel(text);
}

module.exports = {
    classifySocialHiringPost
};
