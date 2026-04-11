'use strict';

/**
 * Cost aggregation worker.
 *
 * Correlates ai_step_telemetry and ci_job_telemetry by ticket_id and writes
 * summarised rows to ticket_cost_summary.
 *
 * Pricing constants (override via env vars for future rate changes):
 *   TOKEN_COST_PER_1K   - USD per 1 000 tokens  (default: $0.003 — Sonnet blended estimate)
 *   COMPUTE_COST_PER_MIN - USD per compute minute (default: $0.008 — ubuntu-latest GitHub-hosted)
 *
 * SEV-1-BREAKGLASS tickets are written but marked excluded_from_baseline = TRUE
 * so they are visible in reports but excluded from anomaly baseline calculations.
 */

const db = require('./db');

const TOKEN_COST_PER_1K    = parseFloat(process.env.TOKEN_COST_PER_1K    || '0.003');
const COMPUTE_COST_PER_MIN = parseFloat(process.env.COMPUTE_COST_PER_MIN || '0.008');
const ANOMALY_THRESHOLD    = parseFloat(process.env.ANOMALY_THRESHOLD    || '1.5');   // 50 % above baseline
const BREAKGLASS_TAG       = 'SEV-1-BREAKGLASS';

/**
 * Aggregate cost data for all tickets that have un-summarised telemetry within
 * the given time window.
 *
 * @param {Date} periodStart
 * @param {Date} periodEnd
 * @returns {Promise<object[]>} Array of upserted summary rows
 */
async function aggregatePeriod(periodStart, periodEnd) {
  // Collect distinct ticket IDs across both telemetry tables in the period
  const ticketRes = await db.query(
    `SELECT DISTINCT ticket_id FROM (
       SELECT ticket_id FROM ai_step_telemetry
        WHERE recorded_at >= $1 AND recorded_at < $2
       UNION
       SELECT ticket_id FROM ci_job_telemetry
        WHERE recorded_at >= $1 AND recorded_at < $2
     ) t`,
    [periodStart, periodEnd]
  );

  const summaries = [];

  for (const row of ticketRes.rows) {
    const ticketId = row.ticket_id;

    // Breakglass check across both tables
    const bgRes = await db.query(
      `SELECT
         (
           EXISTS (
             SELECT 1 FROM ai_step_telemetry
             WHERE ticket_id = $1 AND recorded_at >= $2 AND recorded_at < $3
               AND $4 = ANY(tags)
           ) OR EXISTS (
             SELECT 1 FROM ci_job_telemetry
             WHERE ticket_id = $1 AND recorded_at >= $2 AND recorded_at < $3
               AND $4 = ANY(tags)
           )
         ) AS is_breakglass`,
      [ticketId, periodStart, periodEnd, BREAKGLASS_TAG]
    );

    const tokenTotalsRes = await db.query(
      `SELECT COALESCE(SUM(tokens_used), 0)::integer AS total_tokens
       FROM ai_step_telemetry
       WHERE ticket_id = $1 AND recorded_at >= $2 AND recorded_at < $3`,
      [ticketId, periodStart, periodEnd]
    );

    // Compute totals and outcome
    const computeRes = await db.query(
      `SELECT
         COALESCE(SUM(compute_minutes), 0)::numeric AS total_compute_min,
         -- outcome: success if at least one success and no failures; failure otherwise
         CASE
           WHEN bool_or(outcome = 'success') AND NOT bool_or(outcome = 'failure') THEN 'success'
           WHEN bool_or(outcome = 'failure') THEN 'failure'
           ELSE 'unknown'
         END AS outcome
       FROM ci_job_telemetry
       WHERE ticket_id = $1 AND recorded_at >= $2 AND recorded_at < $3`,
      [ticketId, periodStart, periodEnd]
    );

    const totalTokens      = parseInt(tokenTotalsRes.rows[0].total_tokens, 10);
    const totalComputeMin  = parseFloat(computeRes.rows[0].total_compute_min);
    const outcome          = computeRes.rows[0].outcome;
    const isBreakglass     = bgRes.rows[0].is_breakglass;

    const tokenCostUsd   = (totalTokens / 1000) * TOKEN_COST_PER_1K;
    const computeCostUsd = totalComputeMin * COMPUTE_COST_PER_MIN;
    const totalCostUsd   = tokenCostUsd + computeCostUsd;

    await db.query(
      `INSERT INTO ticket_cost_summary
         (ticket_id, period_start, period_end,
          total_tokens, token_cost_usd,
          total_compute_min, compute_cost_usd,
          total_cost_usd, outcome, excluded_from_baseline)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (ticket_id, period_start, period_end) DO UPDATE SET
         aggregated_at         = NOW(),
         total_tokens          = EXCLUDED.total_tokens,
         token_cost_usd        = EXCLUDED.token_cost_usd,
         total_compute_min     = EXCLUDED.total_compute_min,
         compute_cost_usd      = EXCLUDED.compute_cost_usd,
         total_cost_usd        = EXCLUDED.total_cost_usd,
         outcome               = EXCLUDED.outcome,
         excluded_from_baseline = EXCLUDED.excluded_from_baseline`,
      [
        ticketId, periodStart, periodEnd,
        totalTokens, tokenCostUsd.toFixed(6),
        totalComputeMin.toFixed(2), computeCostUsd.toFixed(6),
        totalCostUsd.toFixed(6), outcome, isBreakglass,
      ]
    );

    summaries.push({ ticketId, totalTokens, tokenCostUsd, totalComputeMin, computeCostUsd, totalCostUsd, outcome, isBreakglass });
  }

  return summaries;
}

/**
 * Calculate the 7-day trailing baseline cost (excluding SEV-1-BREAKGLASS tickets)
 * and emit anomaly alerts for any ticket that exceeds baseline by > ANOMALY_THRESHOLD.
 *
 * @param {object[]} summaries - Rows returned by aggregatePeriod()
 * @returns {Promise<object[]>} Anomalies found
 */
async function checkAnomalies(summaries) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const baselineRes = await db.query(
    `SELECT AVG(total_cost_usd)::numeric AS avg_cost
     FROM ticket_cost_summary
     WHERE period_start >= $1
       AND excluded_from_baseline = FALSE`,
    [sevenDaysAgo]
  );

  const baseline = parseFloat(baselineRes.rows[0].avg_cost || '0');
  const anomalies = [];

  if (baseline === 0) {
    // Not enough history yet — skip anomaly detection
    return anomalies;
  }

  for (const s of summaries) {
    if (s.isBreakglass) continue;
    if (s.totalCostUsd > baseline * ANOMALY_THRESHOLD) {
      anomalies.push({ ...s, baseline, threshold: baseline * ANOMALY_THRESHOLD });
    }
  }

  return anomalies;
}

module.exports = { aggregatePeriod, checkAnomalies };
