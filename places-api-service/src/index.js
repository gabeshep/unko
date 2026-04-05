'use strict';

const fastify = require('fastify');
const placesPlugin = require('./routes/places');

async function main() {
  const app = fastify({ logger: true });

  // Allow requests from the Unko SPA (GitHub Pages or local dev)
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') {
      reply.code(204).send();
    }
  });

  app.register(placesPlugin);

  const port = parseInt(process.env.PORT || '3003', 10);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
