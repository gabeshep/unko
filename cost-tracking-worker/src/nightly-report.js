'use strict';

/**
 * Nightly cron fallback report.
 *
 * Runs at 01:00 UTC daily. Aggregates the previous 24 h of telemetry and:
 *   1. Writes a static CSV to reports/unit-economics-YYYY-MM-DD.csv
 *   2. Checks for anomalies and logs them (FinOps alert hook can be wired here)
 *
 * Can also be invoked directly:  node src/nightly-report.js
 */

const fs   = require('fs');
const path = require('path');
const cron = require('node-cron');
const { aggregatePeriod, checkAnomalies } = require('./aggregator');
const db = require('./db');

const REPORTS_DIR = process.env.REPORTS_DIR || path.join(__dirname, '..', 'reports');

/**
 * Generate the cost-per-success and cost-per-failure summary over a trailing
 * 7-day window from ticket_cost_summary, then dump raw per-ticket rows for
 * the most recent period.
 *
 * @param {Date} periodStart
 * @param {Date} periodEnd
 */
async function generateReport(periodStart, periodEnd) {
  // Aggregate raw telemetry into ticket_cost_summary for the period
  const summaries = await aggregatePeriod(periodStart, periodEnd);

  // Check for anomalies and log them
  const anomalies = await checkAnomalies(summaries);
  if (anomalies.length > 0) {
    for (const a of anomalies) {
      // Structured log — FinOps alerting integrations can tail this
      console.error(JSON.stringify({
        level: 'WARN',
        event: 'unit_economics_anomaly',
        ticket_id: a.ticketId,
        total_cost_usd: a.totalCostUsd.toFixed(6),
        baseline_usd: a.baseline.toFixed(6),
        threshold_usd: a.threshold.toFixed(6),
        outcome: a.outcome,
        message: `Ticket ${a.ticketId} cost $${a.totalCostUsd.toFixed(4)} exceeds baseline $${a.baseline.toFixed(4)} by >50%`,
      }));
    }
  }

  // 7-day trailing summary from ticket_cost_summary
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const trailingRes = await db.query(
    `SELECT
       outcome,
       COUNT(*)                              AS ticket_count,
       AVG(total_cost_usd)::numeric(10,6)   AS avg_cost_usd,
       SUM(total_cost_usd)::numeric(10,6)   AS total_cost_usd,
       AVG(token_cost_usd)::numeric(10,6)   AS avg_token_cost_usd,
       AVG(compute_cost_usd)::numeric(10,6) AS avg_compute_cost_usd
     FROM ticket_cost_summary
     WHERE period_start >= $1
       AND excluded_from_baseline = FALSE
     GROUP BY outcome`,
    [sevenDaysAgo]
  );

  // Build CSV
  const dateLabel = periodEnd.toISOString().slice(0, 10);
  const csvPath   = path.join(REPORTS_DIR, `unit-economics-${dateLabel}.csv`);

  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const lines = [
    // Section 1: 7-day trailing summary
    '# 7-day trailing cost summary (SEV-1-BREAKGLASS excluded)',
    'outcome,ticket_count,avg_cost_usd,total_cost_usd,avg_token_cost_usd,avg_compute_cost_usd',
  ];

  for (const r of trailingRes.rows) {
    lines.push([r.outcome, r.ticket_count, r.avg_cost_usd, r.total_cost_usd, r.avg_token_cost_usd, r.avg_compute_cost_usd].join(','));
  }

  lines.push('');
  lines.push('# Per-ticket detail for this period');
  lines.push('ticket_id,outcome,total_tokens,token_cost_usd,total_compute_min,compute_cost_usd,total_cost_usd,excluded_from_baseline');

  for (const s of summaries) {
    lines.push([
      s.ticketId,
      s.outcome,
      s.totalTokens,
      s.tokenCostUsd.toFixed(6),
      s.totalComputeMin.toFixed(2),
      s.computeCostUsd.toFixed(6),
      s.totalCostUsd.toFixed(6),
      s.isBreakglass,
    ].join(','));
  }

  fs.writeFileSync(csvPath, lines.join('\n') + '\n', 'utf8');
  console.log(JSON.stringify({ level: 'INFO', event: 'nightly_report_written', path: csvPath, tickets: summaries.length, anomalies: anomalies.length }));

  return { csvPath, summaries, anomalies };
}

async function runNightly() {
  const now         = new Date();
  const periodEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); // start of today UTC
  const periodStart = new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);                           // 24 h window

  try {
    await generateReport(periodStart, periodEnd);
  } catch (err) {
    console.error(JSON.stringify({ level: 'ERROR', event: 'nightly_report_failed', error: err.message }));
    process.exitCode = 1;
  }
}

// Schedule: daily at 01:00 UTC
if (require.main !== module) {
  // Exported as a module — caller is responsible for scheduling
  cron.schedule('0 1 * * *', runNightly, { timezone: 'UTC' });
  console.log(JSON.stringify({ level: 'INFO', event: 'nightly_report_scheduled', schedule: '0 1 * * *' }));
} else {
  // Direct invocation: run immediately
  runNightly().then(() => process.exit(process.exitCode || 0));
}

module.exports = { generateReport, runNightly };
