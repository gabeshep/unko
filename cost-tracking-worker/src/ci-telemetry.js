'use strict';

/**
 * CI job compute telemetry emitter.
 *
 * Called from CI pipeline post-job steps (or a webhook listener) to record
 * compute minutes and runner size per job, keyed to a ticket_id.
 *
 * Usage:
 *   const ci = require('./ci-telemetry');
 *   await ci.emitJob({ ticketId, workflowRunId, jobName, runnerSize, computeMinutes, outcome, tags });
 */

const db = require('./db');

/**
 * Emit a single CI job telemetry record.
 *
 * @param {object} opts
 * @param {string}   opts.ticketId        - Ticket identifier
 * @param {string}   opts.workflowRunId   - GitHub Actions run ID
 * @param {string}   opts.jobName         - Job name (e.g. "validate", "e2e-smoke-tests")
 * @param {string}   [opts.runnerSize]    - Runner label (default: "ubuntu-latest")
 * @param {number}   opts.computeMinutes  - Billable compute minutes for this job
 * @param {string}   opts.outcome         - "success" | "failure" | "cancelled"
 * @param {string[]} [opts.tags]          - Optional tags (e.g. ["SEV-1-BREAKGLASS"])
 */
async function emitJob({
  ticketId,
  workflowRunId,
  jobName,
  runnerSize = 'ubuntu-latest',
  computeMinutes,
  outcome,
  tags = [],
}) {
  if (!ticketId || !workflowRunId || !jobName || typeof computeMinutes !== 'number' || !outcome) {
    throw new Error('ci-telemetry: missing required fields');
  }

  await db.query(
    `INSERT INTO ci_job_telemetry
       (ticket_id, workflow_run_id, job_name, runner_size, compute_minutes, outcome, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [ticketId, workflowRunId, jobName, runnerSize, computeMinutes, outcome, tags]
  );
}

module.exports = { emitJob };
