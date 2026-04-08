'use strict';

/**
 * Runaway Retry Token Guard
 *
 * Validates whether an AI pipeline agent is permitted to attempt another CI
 * retry.  The token is "spent" after MAX_RETRIES consecutive failures; any
 * further attempt is rejected and a structured escalation payload is written
 * to stdout so the caller can surface the correct UX copy and hand off to
 * human review.
 *
 * Usage (CLI):
 *   node pipeline/retry-token.js --job-key <key> --retry-count <n>
 *
 * Environment variables (override CLI flags):
 *   RETRY_JOB_KEY      – identifies the CI job being retried
 *   RETRY_COUNT        – how many retries have already been attempted (0-based)
 *   RETRY_MAX          – max retries allowed (default: 3)
 *
 * Exit codes:
 *   0  – retry permitted; JSON result written to stdout
 *   1  – max retries reached or invalid input; JSON result written to stdout
 */

const MAX_RETRIES_DEFAULT = 3;

function fatal(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--job-key' && args[i + 1]) {
      parsed.jobKey = args[++i];
    } else if (args[i] === '--retry-count' && args[i + 1] !== undefined) {
      parsed.retryCount = args[++i];
    } else if (args[i] === '--max-retries' && args[i + 1] !== undefined) {
      parsed.maxRetries = args[++i];
    }
  }
  return parsed;
}

function buildWaitingForHumanCopy(jobKey, retryCount, maxRetries) {
  return {
    title: 'AI Agent Paused — Waiting for Human Review',
    context: `The AI pipeline agent has been attempting to fix a CI failure for job \`${jobKey}\`. It has completed ${retryCount} of ${maxRetries} permitted retries.`,
    reason: `The CI verification loop has hit its configured limit of ${maxRetries} retries. Further automated retries have been blocked to prevent runaway behaviour and unintended side-effects.`,
    decision_options: [
      'Review the CI failure logs and resolve the underlying issue manually.',
      'Reset the retry counter (set retry_count back to 0) and re-trigger the agent if a new approach is warranted.',
      `Invoke the Break-Glass bypass if this is a SEV-1 incident (see docs/runbooks/break-glass.md).`,
    ],
    ai_recommendation: 'Examine the most recent CI failure reason. If the failures share a root cause that a patch has not yet addressed, a human should diagnose and fix before re-enabling automated retries.',
  };
}

function buildMaxReachedCopy(jobKey, retryCount, maxRetries) {
  return {
    title: 'Max CI Retries Reached — Human Action Required',
    attempted: `The agent retried the \`${jobKey}\` CI job ${retryCount} time(s) (limit: ${maxRetries}).`,
    summary: 'All automated retry attempts have been exhausted without a passing CI run.',
    next_steps: [
      '1. Open the CI run linked in the PR and read the failure output carefully.',
      '2. Identify whether the failure is flaky (transient) or deterministic (code issue).',
      '3. If transient: manually re-run the failed job once via the GitHub Actions UI.',
      '4. If deterministic: push a fix commit and re-trigger the agent with retry_count=0.',
      '5. If blocked by a governance issue: follow the Break-Glass runbook at docs/runbooks/break-glass.md.',
    ],
  };
}

function run() {
  const cliArgs = parseArgs();

  const jobKey = process.env.RETRY_JOB_KEY || cliArgs.jobKey;
  const retryCountRaw = process.env.RETRY_COUNT !== undefined
    ? process.env.RETRY_COUNT
    : cliArgs.retryCount;
  const maxRetriesRaw = process.env.RETRY_MAX !== undefined
    ? process.env.RETRY_MAX
    : (cliArgs.maxRetries !== undefined ? cliArgs.maxRetries : String(MAX_RETRIES_DEFAULT));

  if (!jobKey) fatal('--job-key (or RETRY_JOB_KEY env) is required');
  if (retryCountRaw === undefined || retryCountRaw === null) {
    fatal('--retry-count (or RETRY_COUNT env) is required');
  }

  const retryCount = parseInt(retryCountRaw, 10);
  const maxRetries = parseInt(maxRetriesRaw, 10);

  if (isNaN(retryCount) || retryCount < 0) {
    fatal(`retry-count must be a non-negative integer; got: ${retryCountRaw}`);
  }
  if (isNaN(maxRetries) || maxRetries < 1) {
    fatal(`max-retries must be a positive integer; got: ${maxRetriesRaw}`);
  }

  const retriesRemaining = maxRetries - retryCount;
  const allowed = retryCount < maxRetries;

  if (allowed) {
    const result = {
      allowed: true,
      job_key: jobKey,
      retry_count: retryCount,
      max_retries: maxRetries,
      retries_remaining: retriesRemaining,
      next_retry_count: retryCount + 1,
      ux: buildWaitingForHumanCopy(jobKey, retryCount, maxRetries),
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  } else {
    const result = {
      allowed: false,
      job_key: jobKey,
      retry_count: retryCount,
      max_retries: maxRetries,
      retries_remaining: 0,
      ux: buildMaxReachedCopy(jobKey, retryCount, maxRetries),
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(1);
  }
}

run();
