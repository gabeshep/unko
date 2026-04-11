'use strict';

const crypto = require('crypto');
const https = require('https');
const pino = require('pino');

const logger = pino();

// Simple in-memory counter (resets on process restart)
let incident_notify_discord_failures_total = 0;

async function incidentNotifyHandler(request, reply) {
  const rawBody = request.body; // Buffer, thanks to addContentTypeParser
  const signature = request.headers['x-incident-signature'] || '';
  const secret = process.env.INCIDENT_NOTIFY_SECRET;

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

  const { incident_id, severity, message } = body;

  // Validate required fields
  if (
    !incident_id || typeof incident_id !== 'string' ||
    !severity    || typeof severity    !== 'string' ||
    !message     || typeof message     !== 'string' || message.length > 500
  ) {
    return reply.code(400).send({ error: 'Missing required fields' });
  }

  const enabled = process.env.INCIDENT_NOTIFY_ENABLED === 'true';

  if (!enabled) {
    logger.info({ msg: 'incident_notify', incident_id, severity, discord_ok: false });
    return reply.code(200).send({ ok: true, skipped: true });
  }

  // Build Discord message content
  const content = `🚨 Incident [${incident_id}] — Severity: **${severity}**\n${message}`;

  // POST to Discord webhook
  const discordPayload = JSON.stringify({ content });
  const webhookUrl = process.env.DISCORD_INCIDENT_WEBHOOK_URL || '';

  let discord_ok = false;
  try {
    const discordStatus = await new Promise((resolve, reject) => {
      const url = new URL(webhookUrl);
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(discordPayload),
        },
      };
      const req = https.request(options, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.write(discordPayload);
      req.end();
    });

    if (discordStatus >= 200 && discordStatus < 300) {
      discord_ok = true;
    } else {
      incident_notify_discord_failures_total++;
      logger.error({ msg: 'incident_notify_discord_error', statusCode: discordStatus });
      logger.info({ msg: 'incident_notify', incident_id, severity, discord_ok: false });
      return reply.code(502).send({ error: 'Discord notification failed' });
    }
  } catch (err) {
    incident_notify_discord_failures_total++;
    logger.error({ msg: 'incident_notify_discord_error', error: err.message });
    logger.info({ msg: 'incident_notify', incident_id, severity, discord_ok: false });
    return reply.code(502).send({ error: 'Discord notification failed' });
  }

  logger.info({ msg: 'incident_notify', incident_id, severity, discord_ok: true });
  return reply.code(200).send({ ok: true });
}

module.exports = { incidentNotifyHandler };
