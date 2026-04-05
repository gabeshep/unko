'use strict';

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
        AND tenant_id != '__synthetic__'
    `);

    const { count, items } = result.rows[0];
    fastify.log.info({ msg: 'approvals queue fetched', count, synthetic: false });

    return reply.code(200).send({ count, items });
  });

  fastify.get('/approvals/audit-log', async (request, reply) => {
    const result = await db.query(`
      SELECT *
      FROM approvals
      WHERE tenant_id != '__synthetic__'
      ORDER BY created_at DESC
      LIMIT 100
    `);

    return reply.code(200).send({ items: result.rows });
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
