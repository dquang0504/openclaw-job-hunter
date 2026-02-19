require('dotenv').config();
const TelegramReporter = require('./execution/lib/telegram');

async function main() {
    const reporter = new TelegramReporter();

    const mockJob = {
        title: '[Test] Golang Backend Engineer (Fresher)',
        company: 'OpenClaw Tech',
        url: 'https://www.linkedin.com/jobs/view/1234567890',
        salary: '$800 - $1200',
        techStack: 'Golang, PostgreSQL, Docker, Redis',
        location: 'HCM',
        postedDate: '2 days ago',
        description: 'We are looking for a passionate Golang Backend Engineer to join our team...',
        source: 'LinkedIn',
        matchScore: 8,
    };

    console.log('📤 Sending mock job to Telegram...');
    await reporter.sendJobReport(mockJob);
    console.log('✅ Done!');
}

main().catch(console.error);
