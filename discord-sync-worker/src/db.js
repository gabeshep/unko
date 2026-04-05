'use strict';

const { Pool } = require('pg');
const pino = require('pino');

const logger = pino();
let pool;

async function init() {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Column guard: verify required columns exist in approvals table
  const result = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'approvals'
      AND column_name IN ('tenant_id', 'expires_at')
  `);

  const found = result.rows.map((r) => r.column_name);
  const required = ['tenant_id', 'expires_at'];
  const missing = required.filter((col) => !found.includes(col));

  if (missing.length > 0) {
    logger.fatal({ level: 'fatal', msg: 'Required columns absent', missing });
    process.exit(1);
  }

  return pool;
}

async function writeApproval({ approval_id, status, user_id, tenant_id }) {
  const synthetic = tenant_id === '__synthetic__';
  const expiresAt = synthetic ? "NOW() + interval '1 hour'" : 'NULL';

  const text = `
    INSERT INTO approvals (approval_id, status, user_id, tenant_id, expires_at)
    VALUES ($1, $2, $3, $4, ${expiresAt})
    ON CONFLICT (approval_id) DO UPDATE SET
      status = EXCLUDED.status,
      user_id = EXCLUDED.user_id
  `;
  const params = [approval_id, status, user_id, tenant_id];

  logger.info({ msg: 'writeApproval', tenant_id, synthetic });

  await pool.query(text, params);
}

module.exports = { init, writeApproval };
