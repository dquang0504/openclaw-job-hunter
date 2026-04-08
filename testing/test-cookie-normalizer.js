const { normalizeCookies } = require('../tools/cookies-normalizer');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function main() {
    const input = [
        {
            domain: '.facebook.com',
            expirationDate: 1807120876.148153,
            hostOnly: false,
            httpOnly: true,
            name: 'xs',
            path: '/',
            sameSite: 'no_restriction',
            secure: true,
            session: false,
            storeId: null,
            value: 'cookie-value'
        },
        {
            domain: '.threads.com',
            httpOnly: true,
            name: 'rur',
            path: '/',
            sameSite: 'Lax',
            secure: true,
            session: true,
            value: 'session-cookie'
        }
    ];

    const normalized = normalizeCookies(input);

    assert(normalized.length === 2, 'Expected both cookies to remain after normalization');
    assert(normalized[0].expires === 1807120876.148153, 'Expected expirationDate to be mapped to expires');
    assert(normalized[0].sameSite === 'None', 'Expected sameSite normalization to None');
    assert(!Object.prototype.hasOwnProperty.call(normalized[0], 'expirationDate'), 'Expected expirationDate to be removed');
    assert(!Object.prototype.hasOwnProperty.call(normalized[0], 'storeId'), 'Expected extension-only fields to be removed');
    assert(!Object.prototype.hasOwnProperty.call(normalized[1], 'expires'), 'Expected session cookie to omit expires');

    console.log('✅ Cookie normalizer test passed');
}

main().catch(error => {
    console.error(`❌ Cookie normalizer test failed: ${error.message}`);
    process.exit(1);
});
