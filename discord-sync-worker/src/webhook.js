'use strict';

const crypto = require('crypto');
const config = require('./config');
const db = require('./db');

async function webhookHandler(request, reply) {
  const rawBody = request.body; // Buffer, thanks to addContentTypeParser
  const signature = request.headers['x-discord-signature'] || '';
  const secret = config.discordWebhookSecret;

  // Compute HMAC-SHA256
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  const digest = hmac.digest('hex');

  // Timing-safe comparison
  let signatureValid = false;
  try {
    const digestBuf = Buffer.from(digest, 'hex');
    const sigBuf = Buffer.from(signature, 'hex');
    if (digestBuf.length === sigBuf.length) {
      signatureValid = crypto.timingSafeEqual(digestBuf, sigBuf);
    }
  } catch (_) {
    signatureValid = false;
  }

  if (!signatureValid) {
    return reply.code(401).send({ error: 'Invalid signature' });
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch (_) {
    return reply.code(400).send({ error: 'Invalid JSON' });
  }

  const { approval_id, status, user_id } = body;
  if (!approval_id || !status || !user_id) {
    return reply.code(400).send({ error: 'Missing required fields' });
  }

  const tenant_id = body.tenant_id || 'default';

  try {
    await db.writeApproval({ approval_id, status, user_id, tenant_id });
  } catch (err) {
    request.log.error({ msg: 'writeApproval failed, routing to DLQ', error: err.message });
    await db.writeDLQ({ payload: body, error_message: err.message });
    return reply.code(200).send({ ok: true, dlq: true });
  }

  return reply.code(200).send({ ok: true });
}

module.exports = { webhookHandler };
