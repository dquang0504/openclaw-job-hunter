function createRunTelemetry(runPolicy) {
    const startedAt = new Date();
    const taskResults = [];
    const pipeline = {
        rawJobs: 0,
        filteredJobs: 0,
        unseenJobs: 0,
        validatedJobs: 0,
        sentJobs: 0
    };
    const dropReasons = {};
    const healthAlerts = [];

    return {
        startedAt,
        taskResults,
        pipeline,
        recordTaskResult(taskResult) {
            taskResults.push(taskResult);
        },
        setPipelineCounts(nextCounts = {}) {
            Object.assign(pipeline, nextCounts);
        },
        incrementDropReason(reason, count = 1) {
            if (!reason) return;
            dropReasons[reason] = (dropReasons[reason] || 0) + count;
        },
        mergeDropReasons(reasons = {}) {
            for (const [reason, count] of Object.entries(reasons)) {
                this.incrementDropReason(reason, count);
            }
        },
        recordHealthAlert(alert) {
            if (!alert) return;
            healthAlerts.push(alert);
        },
        printTaskSummary() {
            if (taskResults.length === 0) {
                console.log('📡 OpenClaw task summary: no tasks executed');
                return;
            }

            console.log('\n📡 OpenClaw task summary:');
            for (const taskResult of taskResults) {
                const duration = `${taskResult.durationMs}ms`;
                const rawCount = taskResult.metrics?.rawJobCount ?? 0;
                const staleCount = taskResult.metrics?.staleCount ?? 0;
                const scannedCount = taskResult.metrics?.scannedCount ?? 0;
                const warningCount = taskResult.warnings?.length ?? 0;
                const statusLine = `  • ${taskResult.platform}: ${taskResult.status} | raw=${rawCount} | scanned=${scannedCount} | stale=${staleCount} | warnings=${warningCount} | duration=${duration}`;
                console.log(statusLine);

                if (taskResult.error) {
                    console.log(`    error: ${taskResult.error}`);
                }
            }

            const dropReasonEntries = Object.entries(dropReasons);
            if (dropReasonEntries.length > 0) {
                const summary = dropReasonEntries.map(([reason, count]) => `${reason}=${count}`).join(', ');
                console.log(`📉 Drop reasons: ${summary}`);
            }
        },
        buildRunSummary() {
            const finishedAt = new Date();
            const durationMs = finishedAt.getTime() - startedAt.getTime();
            const taskStatusCounts = taskResults.reduce((acc, taskResult) => {
                acc[taskResult.status] = (acc[taskResult.status] || 0) + 1;
                return acc;
            }, {});

            return {
                startedAt: startedAt.toISOString(),
                finishedAt: finishedAt.toISOString(),
                durationMs,
                mode: {
                    dryRun: runPolicy.isDryRun,
                    skipAI: runPolicy.skipAI,
                    platformParam: runPolicy.platformParam
                },
                taskStatusCounts,
                pipeline: { ...pipeline },
                dropReasons: { ...dropReasons },
                healthAlerts: [...healthAlerts],
                tasks: taskResults.map(taskResult => ({
                    platform: taskResult.platform,
                    status: taskResult.status,
                    durationMs: taskResult.durationMs,
                    metrics: taskResult.metrics,
                    warnings: taskResult.warnings,
                    error: taskResult.error
                }))
            };
        }
    };
}

module.exports = { createRunTelemetry };
