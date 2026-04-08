'use strict';

/**
 * Telemetry emitter for AI subagent orchestration steps.
 *
 * Usage:
 *   const emitter = require('./telemetry-emitter');
 *   await emitter.emitStep({ ticketId, actionType, modelName, tokensUsed, tags });
 */

const db = require('./db');

/**
 * Emit a single AI subagent step telemetry record.
 *
 * @param {object} opts
 * @param {string} opts.ticketId    - Ticket identifier (e.g. "PROJ-123")
 * @param {string} opts.actionType  - Step type (e.g. "plan", "code", "ci_verify", "retry")
 * @param {string} opts.modelName   - Model used (e.g. "claude-sonnet-4-6")
 * @param {number} opts.tokensUsed  - Total tokens consumed in this step
 * @param {string[]} [opts.tags]    - Optional tags (e.g. ["SEV-1-BREAKGLASS"])
 */
async function emitStep({ ticketId, actionType, modelName, tokensUsed, tags = [] }) {
  if (!ticketId || !actionType || !modelName || typeof tokensUsed !== 'number') {
    throw new Error('telemetry-emitter: missing required fields');
  }

  await db.query(
    `INSERT INTO ai_step_telemetry (ticket_id, action_type, model_name, tokens_used, tags)
     VALUES ($1, $2, $3, $4, $5)`,
    [ticketId, actionType, modelName, tokensUsed, tags]
  );
}

module.exports = { emitStep };
