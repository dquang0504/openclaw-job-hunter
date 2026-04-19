const assert = require('assert');
const { runFacebookTask } = require('../execution/openclaw/tasks/facebook-search');

async function main() {
    let callCount = 0;
    const page = {
        closed: false,
        async close() {
            this.closed = true;
        }
    };

    const runPolicy = {
        getPlatformConfig() {
            return {
                groups: [
                    'https://facebook.example/group-1',
                    'https://facebook.example/group-2'
                ],
                maxRuntimeMs: 120,
                shutdownBufferMs: 10,
                minGroupBudgetMs: 10
            };
        },
        getTimeoutMs() {
            return 5000;
        }
    };

    const runState = {
        seenJobs: new Set()
    };

    const reporter = {};

    const scrapeFacebookFn = async () => {
        callCount += 1;
        if (callCount === 1) {
            return {
                jobs: [
                    {
                        url: 'https://facebook.example/post-1',
                        title: 'Junior Golang Developer',
                        source: 'Facebook'
                    }
                ],
                staleUrls: ['https://facebook.example/stale-1'],
                warnings: [],
                status: 'success',
                metrics: {
                    scannedCount: 1
                }
            };
        }

        await new Promise(resolve => setTimeout(resolve, 200));
        return {
            jobs: [
                {
                    url: 'https://facebook.example/post-2',
                    title: 'Go Developer',
                    source: 'Facebook'
                }
            ],
            staleUrls: [],
            warnings: [],
            status: 'success',
            metrics: {
                scannedCount: 1
            }
        };
    };

    const result = await runFacebookTask({
        page,
        reporter,
        runState,
        runPolicy,
        scrapeFacebookFn
    });

    assert.equal(result.status, 'partial', 'expected partial status when a group exceeds budget');
    assert.equal(result.jobs.length, 1, 'expected previously collected jobs to be preserved');
    assert.equal(result.jobs[0].url, 'https://facebook.example/post-1', 'expected first group job to survive timeout');
    assert.equal(result.staleUrls.length, 1, 'expected stale urls to be preserved');
    assert.equal(result.metrics.scannedCount, 1, 'expected scanned count from completed groups only');
    assert(page.closed, 'expected page to be closed after soft timeout to stop in-flight work');
    assert(result.warnings.some(warning => warning.includes('preserve Facebook task output')), 'expected preservation warning');

    console.log('✅ Facebook task timeout preservation test passed');
}

main().catch(error => {
    console.error(`❌ Facebook task timeout preservation test failed: ${error.message}`);
    process.exit(1);
});
