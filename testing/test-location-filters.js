const { evaluateJob, analyzeLocation, hasExplicitNonPreferredLocation } = require('../execution/lib/filters');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function buildJob(overrides = {}) {
    return {
        title: 'Junior Golang Developer',
        description: 'Remote junior golang role for backend team',
        company: 'Example Co',
        url: `https://jobs.example/${Math.random().toString(36).slice(2)}`,
        location: 'Remote',
        source: 'Test',
        postedDate: new Date().toISOString(),
        ...overrides
    };
}

async function main() {
    const remoteJob = buildJob();
    const hcmJob = buildJob({ location: 'Ho Chi Minh City' });
    const canThoJob = buildJob({ location: 'Can Tho' });
    const globalJob = buildJob({ location: 'Global' });
    const hanoiJob = buildJob({ location: 'Hanoi' });
    const jimbaranJob = buildJob({ location: 'Jimbaran' });
    const unknownJob = buildJob({ location: 'Unknown' });

    assert(evaluateJob(remoteJob).include, 'Expected remote job to pass');
    assert(evaluateJob(hcmJob).include, 'Expected HCM job to pass');
    assert(evaluateJob(canThoJob).include, 'Expected Can Tho job to pass');
    assert(evaluateJob(globalJob).include, 'Expected global job to pass');
    assert(!evaluateJob(hanoiJob).include, 'Expected Hanoi-only job to be rejected');
    assert(!evaluateJob(jimbaranJob).include, 'Expected non-preferred explicit location to be rejected');
    assert(evaluateJob(unknownJob).include, 'Expected unknown location to remain eligible');

    assert(analyzeLocation('worldwide remote role').preferredLocation === 'Remote', 'Expected remote to win over global when both exist');
    assert(analyzeLocation('global distributed team').preferredLocation === 'Global', 'Expected global location detection');
    assert(hasExplicitNonPreferredLocation('Jimbaran'), 'Expected explicit non-preferred location to be detected');
    assert(!hasExplicitNonPreferredLocation('Unknown'), 'Expected unknown location to stay neutral');

    console.log('✅ Location filter test passed');
}

main().catch(error => {
    console.error(`❌ Location filter test failed: ${error.message}`);
    process.exit(1);
});
