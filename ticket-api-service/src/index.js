'use strict';

const fastify = require('fastify');
const config = require('./config');
const approvalsPlugin = require('./routes/approvals');
const metricsPlugin = require('./routes/metrics');

async function main() {
  const app = fastify({ logger: true });

  app.register(approvalsPlugin);
  app.register(metricsPlugin);

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
