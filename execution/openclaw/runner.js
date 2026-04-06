const { batchValidateJobsWithAI } = require('../lib/ai-filter');
const { calculateMatchScore, evaluateJob } = require('../lib/filters');
const { randomDelay } = require('../lib/stealth');
const { collectTaskResults } = require('./tasks');

async function runOpenClaw({
    page,
    reporter,
    runPolicy,
    runState,
    telemetry,
    healthTracker = null,
    collectTaskResultsFn = collectTaskResults,
    validateJobsFn = batchValidateJobsWithAI,
    delayFn = randomDelay
}) {
    const taskResults = await collectTaskResultsFn({ page, reporter, runPolicy, runState });
    let allRawJobs = [];

    for (const taskResult of taskResults) {
        telemetry.recordTaskResult(taskResult);

        if (taskResult.staleUrls.length > 0) {
            runState.queueSeenEntries(taskResult.staleUrls, 'stale');
            telemetry.incrementDropReason('stale', taskResult.staleUrls.length);
        }

        if (taskResult.status !== 'failed' && taskResult.status !== 'skipped' && taskResult.rawJobs.length > 0) {
            allRawJobs = allRawJobs.concat(taskResult.rawJobs);
        }
    }

    telemetry.setPipelineCounts({ rawJobs: allRawJobs.length });

    if (healthTracker) {
        const alerts = healthTracker.updateFromTaskResults(taskResults);
        for (const alert of alerts) {
            telemetry.recordHealthAlert(alert);
            if (!runPolicy.isDryRun) {
                await reporter.sendStatus(`⚠️ Platform health alert: ${alert.message}`);
            }
        }
    }

    console.log(`\n📦 Total raw jobs collected: ${allRawJobs.length}`);

    const initialCount = allRawJobs.length;
    const filteredJobs = [];
    for (const job of allRawJobs) {
        const evaluation = evaluateJob(job);
        if (evaluation.include) {
            filteredJobs.push(job);
        } else {
            for (const reason of evaluation.reasons) {
                telemetry.incrementDropReason(reason);
            }
        }
    }
    allRawJobs = filteredJobs;
    telemetry.setPipelineCounts({ filteredJobs: allRawJobs.length });
    console.log(`\n🧹 Pre-filtering: ${initialCount} -> ${allRawJobs.length} jobs (removed old/irrelevant)`);

    const unseenJobs = [];
    for (const job of allRawJobs) {
        if (runState.seenJobs.has(job.url)) {
            telemetry.incrementDropReason('seen');
            continue;
        }
        unseenJobs.push(job);
    }
    telemetry.setPipelineCounts({ unseenJobs: unseenJobs.length });
    console.log(`\n🔍 Deduplication: ${allRawJobs.length} total -> ${unseenJobs.length} unseen jobs`);

    if (unseenJobs.length === 0) {
        console.log('ℹ️ No new unseen jobs to process.');
        telemetry.printTaskSummary();
        return {
            taskResults,
            allRawJobs,
            unseenJobs: [],
            validatedNewJobs: [],
            hadNoUnseenJobs: true
        };
    }

    let validatedNewJobs = unseenJobs;

    if (!runPolicy.skipAI) {
        const aiResults = await validateJobsFn(unseenJobs);
        validatedNewJobs = [];

        for (const job of unseenJobs) {
            const result = aiResults.get(job.id);
            const mappedJob = result
                ? {
                    ...job,
                    matchScore: result.score,
                    aiReason: result.reason,
                    aiValidated: result.isValid,
                    location: (result.location && result.location !== 'Unknown') ? result.location : job.location,
                    postedDate: (result.postedDate && result.postedDate !== 'Unknown') ? result.postedDate : job.postedDate,
                    techStack: result.techStack || job.techStack
                }
                : {
                    ...job,
                    matchScore: calculateMatchScore(job),
                    aiValidated: true
                };

            if (!mappedJob.aiValidated) {
                telemetry.incrementDropReason('ai_invalid');
                continue;
            }
            if (mappedJob.matchScore < 5) {
                telemetry.incrementDropReason('ai_low_score');
                continue;
            }

            validatedNewJobs.push(mappedJob);
        }
    } else {
        validatedNewJobs = [];
        for (const job of unseenJobs) {
            const scoredJob = {
                ...job,
                matchScore: calculateMatchScore(job),
                aiValidated: true,
                aiReason: 'no-ai-mode'
            };

            if (scoredJob.matchScore < 5) {
                telemetry.incrementDropReason('score_below_threshold');
                continue;
            }

            validatedNewJobs.push(scoredJob);
        }
    }

    validatedNewJobs.sort((left, right) => right.matchScore - left.matchScore);
    telemetry.setPipelineCounts({ validatedJobs: validatedNewJobs.length });

    console.log(`\n📊 Found ${validatedNewJobs.length} valid NEW jobs to send`);

    if (validatedNewJobs.length === 0) {
        console.log('ℹ️ No valid new jobs found after AI validation');
        telemetry.printTaskSummary();
        return {
            taskResults,
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
            await delayFn(500, 1000);
        }

        sentUrls.push(job.url);
    }

    runState.queueSeenEntries(sentUrls, 'sent');
    telemetry.setPipelineCounts({ sentJobs: jobsToSend.length });
    await reporter.sendStatus(`✅ Tìm được ${validatedNewJobs.length} jobs mới valid, đã gửi ${jobsToSend.length} jobs.`);
    telemetry.printTaskSummary();

    return {
        taskResults,
        allRawJobs,
        unseenJobs,
        validatedNewJobs,
        hadNoUnseenJobs: false
    };
}

module.exports = { runOpenClaw };
