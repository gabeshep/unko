'use strict';

const fastify = require('fastify');
const approvalsPlugin = require('./routes/approvals');
const metricsPlugin = require('./routes/metrics');

async function main() {
  const app = fastify({ logger: true });

  app.register(approvalsPlugin);
  app.register(metricsPlugin);

  const port = parseInt(process.env.PORT || '3002', 10);

  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
