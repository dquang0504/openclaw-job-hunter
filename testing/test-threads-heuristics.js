const assert = require('assert');
const { looksLikeSocialHiringPost } = require('../execution/lib/filters');
const { __private } = require('../execution/scrapers/threads');

function run() {
    const realJobPost = `
        We are hiring a Junior Golang Developer
        Location: Remote
        Salary: 25-35tr
        Send CV to jobs@example.com
    `;

    const noisyPost = 'SwiftUI x golang my pick';
    const candidatePost = 'Open to work Golang backend developer intern, here is my CV';

    assert.equal(looksLikeSocialHiringPost(realJobPost), true, 'expected real hiring post to pass');
    assert.equal(__private.isPotentialJobPost(realJobPost), true, 'threads job heuristic should pass real hiring post');

    assert.equal(looksLikeSocialHiringPost(noisyPost), false, 'expected non-job discussion to fail');
    assert.equal(__private.isPotentialJobPost(noisyPost), false, 'threads job heuristic should reject noisy post');

    assert.equal(looksLikeSocialHiringPost(candidatePost), false, 'expected candidate-seeking post to fail');

    console.log('✅ Threads heuristics test passed');
}

run();
