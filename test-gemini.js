require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGemini() {
    const key = process.env.GEMINI_API_KEY;
    console.log('Checking API Key:', key ? `Present (${key.length} chars)` : 'Missing');

    if (!key) {
        console.error('❌ API Key is missing');
        return;
    }

    try {
        console.log('🔄 Initializing Gemini...');
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        console.log('📤 Sending test prompt...');
        const result = await model.generateContent('Hello, are you working?');
        const response = result.response;
        const text = response.text();

        console.log('✅ Success! Response:', text);
    } catch (error) {
        console.error('\n❌ ERROR DETAILS:');
        console.error('Message:', error.message);
        console.error('Stack:', error.stack);
        if (error.cause) {
            console.error('Cause:', error.cause);
        }
    }
}

testGemini();
