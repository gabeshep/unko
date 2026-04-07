'use strict';

const FSQ_ENDPOINT = 'https://api.foursquare.com/v3/places/search';

const FSQ_CATEGORIES = {
  eat: '13000',
  see: '16000',
  do: '10000,18000',
};

const RADII = {
  eat: 1500,
  see: 2500,
  do: 3000,
};

const VALID_CATS = new Set(['eat', 'see', 'do']);

async function placesPlugin(fastify) {
  fastify.get('/places/search', {
    schema: {
      querystring: {
        type: 'object',
        required: ['ll', 'cat'],
        properties: {
          ll:       { type: 'string', pattern: '^-?\\d+(\\.\\d+)?,-?\\d+(\\.\\d+)?$' },
          cat:      { type: 'string', enum: ['eat', 'see', 'do'] },
          open_now: { type: 'string', enum: ['true', 'false'] },
        },
      },
    },
  }, async (request, reply) => {
    const apiKey = process.env.FOURSQUARE_API_KEY;
    if (!apiKey) {
      return reply.code(503).send({ error: 'FOURSQUARE_API_KEY is not configured on the server' });
    }

    const { ll, cat, open_now } = request.query;

    const url = new URL(FSQ_ENDPOINT);
    url.searchParams.set('ll', ll);
    url.searchParams.set('categories', FSQ_CATEGORIES[cat]);
    url.searchParams.set('radius', String(RADII[cat]));
    url.searchParams.set('limit', '50');
    url.searchParams.set('fields', 'fsq_id,name,categories,geocodes,location,hours');
    if (open_now === 'true') url.searchParams.set('open_now', 'true');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    let res;
    try {
      res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      fastify.log.warn({ event: 'foursquare_timeout', cat }, 'Foursquare request failed');
      return reply.code(503).send({ error: 'Places service temporarily unavailable' });
    }
    clearTimeout(timer);

    if (!res.ok) {
      fastify.log.error({ status: res.status }, 'Foursquare API error');
      return reply.code(502).send({ error: `Foursquare API returned ${res.status}` });
    }

    const data = await res.json();
    reply.send(data);
  });

  // Health check
  fastify.get('/health', async () => ({ status: 'ok' }));

  // Deep health check — verifies FOURSQUARE_API_KEY is present and that Foursquare is reachable
  fastify.get('/health/deep', async (request, reply) => {
    const apiKey = process.env.FOURSQUARE_API_KEY;

    if (!apiKey) {
      const status = 'degraded';
      const checks = { api_key: 'missing', foursquare_connectivity: 'skipped' };
      fastify.log.info({ event: 'health_check_deep', status, checks });
      return reply.code(503).send({ status, checks });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    let res;
    try {
      res = await fetch(
        'https://api.foursquare.com/v3/places/search?ll=48.8566,2.3522&categories=13000&limit=1&fields=fsq_id',
        {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
          signal: controller.signal,
        },
      );
    } catch (err) {
      clearTimeout(timer);
      const status = 'degraded';
      const checks = { api_key: 'configured', foursquare_connectivity: 'timeout' };
      fastify.log.info({ event: 'health_check_deep', status, checks });
      return reply.code(503).send({ status, checks });
    }
    clearTimeout(timer);

    if (!res.ok) {
      const status = 'degraded';
      const checks = { api_key: 'configured', foursquare_connectivity: `http_${res.status}` };
      fastify.log.info({ event: 'health_check_deep', status, checks });
      return reply.code(503).send({ status, checks });
    }

    const status = 'ok';
    const checks = { api_key: 'configured', foursquare_connectivity: 'ok' };
    fastify.log.info({ event: 'health_check_deep', status, checks });
    return reply.code(200).send({ status, checks });
  });
}

module.exports = placesPlugin;
