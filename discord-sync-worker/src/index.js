'use strict';

const fastify = require('fastify');
const db = require('./db');
const { webhookHandler } = require('./webhook');
const canary = require('./canary');

async function main() {
  const app = fastify({ logger: true });

  // Parse application/json as raw buffer so we can verify HMAC over the raw body
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    done(null, body);
  });

  // Column guard — exits if required columns are missing
  await db.init();

  // Routes
  app.post('/webhook/discord/approval', webhookHandler);

  const port = parseInt(process.env.PORT || '3001', 10);

  await app.listen({ port, host: '0.0.0.0' });

  canary.startCanary(port);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
