const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = process.argv[2] || '.tmp/artifacts';
const OUTPUT_FILE = process.argv[3] || 'logs/seen-jobs.json';

console.log(`🔨 Merging seen jobs from ${ARTIFACTS_DIR} to ${OUTPUT_FILE}`);

if (!fs.existsSync(ARTIFACTS_DIR)) {
    console.error(`❌ Artifacts directory not found: ${ARTIFACTS_DIR}`);
    // If no artifacts, maybe just exit? Or fail?
    // Let's create an empty file if needed, or just exit.
    // If this runs, it expects artifacts.
    process.exit(0);
}

// Ensure output dir exists
const outDir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

let allJobs = new Map(); // Use Map to deduplicate by URL

// Helper to process a file
function processFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const jobs = JSON.parse(content);
        if (Array.isArray(jobs)) {
            jobs.forEach(job => {
                // Keep the latest timestamp if duplicate
                if (job.url && (!allJobs.has(job.url) || allJobs.get(job.url).timestamp < job.timestamp)) {
                    allJobs.set(job.url, job);
                }
            });
            console.log(`  ✅ Loaded ${jobs.length} jobs from ${path.basename(filePath)}`);
        }
    } catch (e) {
        console.warn(`  ⚠️ Failed to parse ${path.basename(filePath)}: ${e.message}`);
    }
}

// Recursively find JSON files (since download-artifact might create subdirs)
function scanDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            scanDir(fullPath);
        } else if (file.endsWith('.json') && file.includes('seen-jobs')) {
            processFile(fullPath);
        }
    }
}

scanDir(ARTIFACTS_DIR);

const merged = Array.from(allJobs.values());
// Sort by timestamp desc to keep file tidy
merged.sort((a, b) => b.timestamp - a.timestamp);

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(merged, null, 2));
console.log(`🎉 Successfully merged ${merged.length} unique jobs into ${OUTPUT_FILE}`);
