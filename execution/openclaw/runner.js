const { batchValidateJobsWithAI } = require('../lib/ai-filter');
const { calculateMatchScore, shouldIncludeJob } = require('../lib/filters');
const { randomDelay } = require('../lib/stealth');
const { collectTaskResults } = require('./tasks');

async function runOpenClaw({ page, reporter, runPolicy, runState, telemetry }) {
    const taskResults = await collectTaskResults({ page, reporter, runPolicy, runState });
    let allRawJobs = [];

    for (const taskResult of taskResults) {
        telemetry.recordTaskResult(taskResult);

        if (taskResult.staleUrls.length > 0) {
            runState.queueSeenEntries(taskResult.staleUrls, 'stale');
        }

        if (taskResult.status !== 'failed' && taskResult.status !== 'skipped' && taskResult.rawJobs.length > 0) {
            allRawJobs = allRawJobs.concat(taskResult.rawJobs);
        }
    }

    telemetry.printTaskSummary();
    telemetry.setPipelineCounts({ rawJobs: allRawJobs.length });

    console.log(`\n📦 Total raw jobs collected: ${allRawJobs.length}`);

    const initialCount = allRawJobs.length;
    allRawJobs = allRawJobs.filter(job => shouldIncludeJob(job));
    telemetry.setPipelineCounts({ filteredJobs: allRawJobs.length });
    console.log(`\n🧹 Pre-filtering: ${initialCount} -> ${allRawJobs.length} jobs (removed old/irrelevant)`);

    const unseenJobs = allRawJobs.filter(job => !runState.seenJobs.has(job.url));
    telemetry.setPipelineCounts({ unseenJobs: unseenJobs.length });
    console.log(`\n🔍 Deduplication: ${allRawJobs.length} total -> ${unseenJobs.length} unseen jobs`);

    if (unseenJobs.length === 0) {
        console.log('ℹ️ No new unseen jobs to process.');
        return {
            allRawJobs,
            unseenJobs: [],
            validatedNewJobs: [],
            hadNoUnseenJobs: true
        };
    }

    let validatedNewJobs = unseenJobs;

    if (!runPolicy.skipAI) {
        const aiResults = await batchValidateJobsWithAI(unseenJobs);
        validatedNewJobs = unseenJobs
            .map(job => {
                const result = aiResults.get(job.id);
                if (result) {
                    return {
                        ...job,
                        matchScore: result.score,
                        aiReason: result.reason,
                        aiValidated: result.isValid,
                        location: (result.location && result.location !== 'Unknown') ? result.location : job.location,
                        postedDate: (result.postedDate && result.postedDate !== 'Unknown') ? result.postedDate : job.postedDate,
                        techStack: result.techStack || job.techStack
                    };
                }

                return {
                    ...job,
                    matchScore: calculateMatchScore(job),
                    aiValidated: true
                };
            })
            .filter(job => job.aiValidated && job.matchScore >= 5);
    }

    validatedNewJobs.sort((left, right) => right.matchScore - left.matchScore);
    telemetry.setPipelineCounts({ validatedJobs: validatedNewJobs.length });

    console.log(`\n📊 Found ${validatedNewJobs.length} valid NEW jobs to send`);

    if (validatedNewJobs.length === 0) {
        console.log('ℹ️ No valid new jobs found after AI validation');
        return {
            allRawJobs,
            unseenJobs,
            validatedNewJobs,
            hadNoUnseenJobs: false
        };
    }

    const jobsToSend = validatedNewJobs.slice(0, runPolicy.maxJobsToSend);
    const sentUrls = [];

    for (const job of jobsToSend) {
        console.log(`  [${job.matchScore}/10] ${job.title?.slice(0, 50)} @ ${job.company}`);

        if (!runPolicy.isDryRun) {
            await reporter.sendJobReport(job);
            await randomDelay(500, 1000);
        }

        sentUrls.push(job.url);
    }

    runState.queueSeenEntries(sentUrls, 'sent');
    telemetry.setPipelineCounts({ sentJobs: jobsToSend.length });
    await reporter.sendStatus(`✅ Tìm được ${validatedNewJobs.length} jobs mới valid, đã gửi ${jobsToSend.length} jobs.`);

    return {
        allRawJobs,
        unseenJobs,
        validatedNewJobs,
        hadNoUnseenJobs: false
    };
}

module.exports = { runOpenClaw };
