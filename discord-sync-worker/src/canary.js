'use strict';

const crypto = require('crypto');
const http = require('http');
const cron = require('node-cron');
const pino = require('pino');
const config = require('./config');

const logger = pino();

let lastSuccessTimestamp = 0;

function startCanary(port) {
  cron.schedule('*/5 * * * *', () => {
    const payload = {
      approval_id: 'canary-' + Date.now(),
      status: 'pending',
      user_id: 'canary',
      tenant_id: '__synthetic__',
    };

    const body = JSON.stringify(payload);
    const secret = config.discordWebhookSecret;

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(body);
    const signature = hmac.digest('hex');

    const options = {
      hostname: '127.0.0.1',
      port,
      path: '/webhook/discord/approval',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Discord-Signature': signature,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      if (res.statusCode === 200) {
        lastSuccessTimestamp = Math.floor(Date.now() / 1000);
        logger.info({ msg: 'canary success', synthetic: true, tenant_id: '__synthetic__' });
      } else {
        logger.error({ msg: 'canary failed', synthetic: true, error: `HTTP ${res.statusCode}` });
      }
      // Drain the response
      res.resume();
    });

    req.on('error', (err) => {
      logger.error({ msg: 'canary failed', synthetic: true, error: err.message });
    });

    req.write(body);
    req.end();
  });
}

module.exports = { lastSuccessTimestamp, startCanary };
