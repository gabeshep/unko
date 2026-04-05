'use strict';

const crypto = require('crypto');
const https = require('https');
const pino = require('pino');

const logger = pino();

async function deployNotifyHandler(request, reply) {
  const rawBody = request.body; // Buffer, thanks to addContentTypeParser
  const signature = request.headers['x-deploy-signature'] || '';
  const secret = process.env.DEPLOY_NOTIFY_SECRET;

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

  const { status, commit_sha, commit_message, deploy_url, actor } = body;
  if (!status || !commit_sha || !commit_message) {
    return reply.code(400).send({ error: 'Missing required fields' });
  }

  const enabled = process.env.DEPLOYMENT_NOTIFY_ENABLED === 'true';

  if (!enabled) {
    logger.info({ msg: 'deploy_notify', status, commit_sha, enabled: false, discord_ok: false });
    return reply.code(200).send({ ok: true, skipped: true });
  }

  // Build Discord message content
  const truncatedMsg = (commit_message || '').slice(0, 100);
  let content;
  if (status === 'success') {
    content = `✅ Deploy succeeded\n**Commit:** \`${commit_sha}\`\n**Message:** ${truncatedMsg}\n**Actor:** ${actor}\n**URL:** ${deploy_url}`;
  } else {
    content = `❌ Deploy failed\n**Commit:** \`${commit_sha}\`\n**Message:** ${truncatedMsg}\n**Actor:** ${actor}`;
  }

  // POST to Discord webhook
  const discordPayload = JSON.stringify({ content });
  const webhookUrl = process.env.DISCORD_DEPLOY_WEBHOOK_URL || '';

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
      logger.error({ msg: 'deploy_notify_discord_error', statusCode: discordStatus });
      logger.info({ msg: 'deploy_notify', status, commit_sha, enabled: true, discord_ok: false });
      return reply.code(502).send({ error: 'Discord notification failed' });
    }
  } catch (err) {
    logger.error({ msg: 'deploy_notify_discord_error', error: err.message });
    logger.info({ msg: 'deploy_notify', status, commit_sha, enabled: true, discord_ok: false });
    return reply.code(502).send({ error: 'Discord notification failed' });
  }

  logger.info({ msg: 'deploy_notify', status, commit_sha, enabled: true, discord_ok: true });
  return reply.code(200).send({ ok: true });
}

module.exports = { deployNotifyHandler };
