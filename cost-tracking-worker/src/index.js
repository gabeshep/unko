'use strict';

/**
 * cost-tracking-worker
 *
 * Provides:
 *   - HTTP ingestion endpoints for AI step and CI job telemetry
 *   - Nightly cron to aggregate metrics and emit CSV reports
 *   - FinOps anomaly alert logging when a ticket cost exceeds baseline by >50%
 */

const fastify = require('fastify');
const config = require('./config');
const { emitStep }  = require('./telemetry-emitter');
const { emitJob }   = require('./ci-telemetry');
const { aggregatePeriod, checkAnomalies } = require('./aggregator');

// Start nightly report scheduler as a side-effect
require('./nightly-report');

async function main() {
  const app = fastify({ logger: true });

  /**
   * POST /telemetry/ai-step
   * Record one AI subagent step.
   * Body: { ticketId, actionType, modelName, tokensUsed, tags? }
   */
  app.post('/telemetry/ai-step', async (request, reply) => {
    const { ticketId, actionType, modelName, tokensUsed, tags } = request.body || {};
    try {
      await emitStep({ ticketId, actionType, modelName, tokensUsed, tags });
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
    return reply.code(201).send({ ok: true });
  });

  /**
   * POST /telemetry/ci-job
   * Record one CI job compute event.
   * Body: { ticketId, workflowRunId, jobName, runnerSize?, computeMinutes, outcome, tags? }
   */
  app.post('/telemetry/ci-job', async (request, reply) => {
    const { ticketId, workflowRunId, jobName, runnerSize, computeMinutes, outcome, tags } = request.body || {};
    try {
      await emitJob({ ticketId, workflowRunId, jobName, runnerSize, computeMinutes, outcome, tags });
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
    return reply.code(201).send({ ok: true });
  });

  /**
   * POST /aggregate
   * Trigger an on-demand aggregation for a period.
   * Body: { periodStart, periodEnd }  — ISO 8601 strings
   */
  app.post('/aggregate', async (request, reply) => {
    const { periodStart, periodEnd } = request.body || {};
    if (!periodStart || !periodEnd) {
      return reply.code(400).send({ error: 'periodStart and periodEnd required' });
    }
    const summaries  = await aggregatePeriod(new Date(periodStart), new Date(periodEnd));
    const anomalies  = await checkAnomalies(summaries);
    return reply.code(200).send({ summaries, anomalies });
  });

  /**
   * GET /healthz
   */
  app.get('/healthz', async (_request, reply) => {
    return reply.code(200).send({ ok: true });
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
