'use strict';

const http = require('http');
const promClient = require('prom-client');
const db = require('../db');

const breakGlassCounter = new promClient.Counter({
  name: 'break_glass_invocations_total',
  help: 'Total number of break-glass audit log entries written',
  labelNames: ['shadow_mode'],
});

async function approvalsPlugin(fastify, _opts) {
  fastify.get('/approvals/queue', async (request, reply) => {
    const result = await db.query(`
      SELECT
        COUNT(*)::int AS count,
        COALESCE(json_agg(row_to_json(a)), '[]'::json) AS items
      FROM approvals a
      WHERE status = 'pending'
        AND tenant_id IS DISTINCT FROM '__synthetic__'
    `);

    const { count, items } = result.rows[0];
    fastify.log.info({ msg: 'approvals queue fetched', count, synthetic: false });

    return reply.code(200).send({ count, items });
  });

  fastify.get('/approvals/audit-log', async (request, reply) => {
    const result = await db.query(`
      SELECT *
      FROM approvals
      WHERE tenant_id IS DISTINCT FROM '__synthetic__'
      ORDER BY created_at DESC
      LIMIT 100
    `);

    return reply.code(200).send({ items: result.rows });
  });

  fastify.get('/sync-status', async (request, reply) => {
    // Direct DB count
    const dbResult = await db.query(`
      SELECT COUNT(*)::int AS count
      FROM approvals
      WHERE status = 'pending'
        AND tenant_id IS DISTINCT FROM '__synthetic__'
    `);
    const dbCount = dbResult.rows[0].count;

    // API count via internal HTTP call to /approvals/queue
    const port = process.env.PORT || 3002;
    let apiCount;
    let apiError = null;
    try {
      apiCount = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/approvals/queue`, { timeout: 5000 }, (res) => {
          let raw = '';
          res.on('data', (chunk) => { raw += chunk; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(raw).count);
            } catch (err) {
              reject(err);
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });
    } catch (err) {
      apiError = err.message;
    }

    if (apiError !== null) {
      fastify.log.error({ event: 'sync_status_check', db_count: dbCount, api_error: apiError });
      return reply.code(503).send({
        sync: 'error',
        db_count: dbCount,
        api_count: null,
        drift: null,
        error: apiError,
      });
    }

    const drift = dbCount - apiCount;
    const inSync = drift === 0;

    fastify.log.info({ event: 'sync_status_check', db_count: dbCount, api_count: apiCount, drift, in_sync: inSync });

    return reply.code(inSync ? 200 : 503).send({
      sync: inSync ? 'ok' : 'drift',
      db_count: dbCount,
      api_count: apiCount,
      drift,
    });
  });

  fastify.post('/break-glass/audit', async (request, reply) => {
    const {
      payload_hash,
      sre_key_id,
      sre_identity,
      release_eng_key_id,
      release_eng_identity,
      shadow_mode,
    } = request.body || {};

    if (
      payload_hash === undefined ||
      sre_key_id === undefined ||
      sre_identity === undefined ||
      release_eng_key_id === undefined ||
      release_eng_identity === undefined ||
      shadow_mode === undefined
    ) {
      return reply.code(400).send({ error: 'Missing required fields' });
    }

    const result = await db.query(
      `INSERT INTO break_glass_audit_log
         (payload_hash, sre_key_id, sre_identity, release_eng_key_id, release_eng_identity, shadow_mode)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [payload_hash, sre_key_id, sre_identity, release_eng_key_id, release_eng_identity, shadow_mode]
    );

    const id = result.rows[0].id;
    breakGlassCounter.inc({ shadow_mode: String(shadow_mode) });

    fastify.log.info({
      event: 'break_glass_audit_written',
      shadow_mode,
      sre_key_id,
      release_eng_key_id,
      payload_hash,
    });

    return reply.code(200).send({ ok: true, id });
  });
}

module.exports = approvalsPlugin;
