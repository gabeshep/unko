'use strict';

const fastify = require('fastify');
const config = require('./config');
const placesPlugin = require('./routes/places');

async function main() {
  const app = fastify({ logger: true });

  // Allow requests from the Unko SPA (GitHub Pages or local dev)
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', config.corsOrigin);
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') {
      reply.code(204).send();
    }
  });

  if (!config.foursquareApiKey) {
    app.log.warn('FOURSQUARE_API_KEY not set — /places/search will return 503 until configured');
  }

  app.register(placesPlugin);

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
