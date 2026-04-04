'use strict';

const db = require('../db');

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
}

module.exports = approvalsPlugin;
