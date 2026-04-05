'use strict';

const promClient = require('prom-client');
const db = require('../db');

async function metricsPlugin(fastify, _opts) {
  const registry = new promClient.Registry();

  const pendingDbCount = new promClient.Gauge({
    name: 'approvals_pending_db_count',
    help: 'Count of pending approvals (excluding synthetic) from direct DB query',
    registers: [registry],
  });

  const queueApiCount = new promClient.Gauge({
    name: 'approvals_queue_api_count',
    help: 'Count of pending approvals from the internal approvals queue query',
    registers: [registry],
  });

  const canaryLastSuccess = new promClient.Gauge({
    name: 'approvals_canary_last_success_seconds',
    help: 'Unix epoch seconds of the last canary approval record written to DB',
    registers: [registry],
  });

  fastify.get('/metrics', async (request, reply) => {
    // Query 1: direct pending count
    const pendingResult = await db.query(`
      SELECT COUNT(*)::int AS count
      FROM approvals
      WHERE status = 'pending'
        AND tenant_id IS DISTINCT FROM '__synthetic__'
    `);
    pendingDbCount.set(pendingResult.rows[0].count);

    // Query 2: count from the /approvals/queue HTTP endpoint (reflects actual API response)
    await new Promise((resolve) => {
      const port = process.env.PORT || 3002;
      const http = require('http');
      const req = http.get(`http://127.0.0.1:${port}/approvals/queue`, { timeout: 5000 }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const body = JSON.parse(raw);
            queueApiCount.set(body.count);
          } catch (err) {
            fastify.log.error({ msg: 'metrics: failed to parse /approvals/queue response', err: err.message });
            queueApiCount.set(-1);
          }
          resolve();
        });
      });
      req.on('error', (err) => {
        fastify.log.error({ msg: 'metrics: internal call to /approvals/queue failed', err: err.message });
        queueApiCount.set(-1);
        resolve();
      });
      req.on('timeout', () => {
        fastify.log.error({ msg: 'metrics: internal call to /approvals/queue timed out' });
        req.destroy();
        queueApiCount.set(-1);
        resolve();
      });
    });

    // Query 3: last canary record epoch
    const canaryResult = await db.query(`
      SELECT EXTRACT(EPOCH FROM MAX(created_at))::bigint AS ts
      FROM approvals
      WHERE tenant_id = '__synthetic__'
    `);
    const ts = canaryResult.rows[0].ts;
    canaryLastSuccess.set(ts !== null ? Number(ts) : 0);

    const metricsOutput = await registry.metrics();

    return reply
      .header('Content-Type', registry.contentType)
      .send(metricsOutput);
  });
}

module.exports = metricsPlugin;
