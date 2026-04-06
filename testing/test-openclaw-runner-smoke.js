const { createRunPolicy } = require('../execution/openclaw/policies');
const { createRunTelemetry } = require('../execution/openclaw/telemetry');
const { runOpenClaw } = require('../execution/openclaw/runner');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function main() {
    const runPolicy = createRunPolicy(['--dry-run', '--no-ai']);
    const telemetry = createRunTelemetry(runPolicy);
    const queuedEntries = [];
    const sentStatuses = [];

    const runState = {
        seenJobs: new Set(['https://jobs.example/seen']),
        queueSeenEntries(items, status) {
            queuedEntries.push({ items, status });
        }
    };

    const reporter = {
        async sendJobReport() {},
        async sendStatus(message) {
            sentStatuses.push(message);
        }
    };

    const taskResults = [
        {
            platform: 'facebook',
            status: 'success',
            rawJobs: [
                {
                    id: 'fb-1',
                    title: 'Junior Golang Developer',
                    description: 'Remote junior golang role',
                    company: 'Example Co',
                    url: 'https://jobs.example/new',
                    location: 'Remote',
                    source: 'Facebook',
                    postedDate: new Date().toISOString()
                },
                {
                    id: 'fb-2',
                    title: 'Senior Golang Developer',
                    description: 'Need 5 years experience',
                    company: 'Example Co',
                    url: 'https://jobs.example/reject',
                    location: 'Hanoi',
                    source: 'Facebook',
                    postedDate: new Date().toISOString()
                },
                {
                    id: 'fb-3',
                    title: 'Junior Golang Developer',
                    description: 'Remote junior golang role',
                    company: 'Example Co',
                    url: 'https://jobs.example/seen',
                    location: 'Remote',
                    source: 'Facebook',
                    postedDate: new Date().toISOString()
                }
            ],
            staleUrls: ['https://jobs.example/stale'],
            warnings: [],
            error: null,
            durationMs: 10,
            metrics: {
                rawJobCount: 3,
                staleCount: 1,
                scannedCount: 3
            }
        }
    ];

    const runResult = await runOpenClaw({
        page: null,
        reporter,
        runPolicy,
        runState,
        telemetry,
        collectTaskResultsFn: async () => taskResults
    });

    const summary = telemetry.buildRunSummary();

    assert(runResult.allRawJobs.length === 2, 'Expected two pre-filtered raw jobs before dedup');
    assert(runResult.unseenJobs.length === 1, 'Expected one unseen job after dedup');
    assert(runResult.validatedNewJobs.length === 1, 'Expected one validated job with --no-ai');
    assert(summary.dropReasons.level_reject === 1, 'Expected one level rejection');
    assert(summary.dropReasons.seen === 1, 'Expected one seen rejection');
    assert(queuedEntries.some(entry => entry.status === 'stale'), 'Expected stale entries to be queued');
    assert(queuedEntries.some(entry => entry.status === 'sent'), 'Expected sent entries to be queued');
    assert(sentStatuses.length === 1, 'Expected a status message to be sent');

    console.log('✅ OpenClaw runner smoke test passed');
}

main().catch(error => {
    console.error(`❌ OpenClaw runner smoke test failed: ${error.message}`);
    process.exit(1);
});
