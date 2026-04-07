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

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });

    if (!res.ok) {
      fastify.log.error({ status: res.status }, 'Foursquare API error');
      return reply.code(502).send({ error: `Foursquare API returned ${res.status}` });
    }

    const data = await res.json();
    reply.send(data);
  });

  // Health check
  fastify.get('/health', async () => ({ status: 'ok' }));
}

module.exports = placesPlugin;
