'use strict';

const { Pool } = require('pg');
const pino = require('pino');

const logger = pino();
let pool;

async function init() {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Column guard: verify required columns exist in approvals table
  const approvalsResult = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'approvals'
      AND column_name IN ('tenant_id', 'expires_at')
  `);

  const foundApprovals = approvalsResult.rows.map((r) => r.column_name);
  const requiredApprovals = ['tenant_id', 'expires_at'];
  const missingApprovals = requiredApprovals.filter((col) => !foundApprovals.includes(col));

  if (missingApprovals.length > 0) {
    logger.fatal({ level: 'fatal', msg: 'Required columns absent in approvals', missing: missingApprovals });
    process.exit(1);
  }

  // Column guard: verify required columns exist in dead_letter_queue table
  const dlqResult = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'dead_letter_queue'
      AND column_name IN ('payload', 'error_message')
  `);

  const foundDlq = dlqResult.rows.map((r) => r.column_name);
  const requiredDlq = ['payload', 'error_message'];
  const missingDlq = requiredDlq.filter((col) => !foundDlq.includes(col));

  if (missingDlq.length > 0) {
    logger.fatal({ level: 'fatal', msg: 'Required columns absent in dead_letter_queue', missing: missingDlq });
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

async function writeDLQ({ payload, error_message }) {
  const text = `
    INSERT INTO dead_letter_queue (payload, error_message)
    VALUES ($1, $2)
  `;
  await pool.query(text, [JSON.stringify(payload), error_message]);
}

module.exports = { init, writeApproval, writeDLQ };
