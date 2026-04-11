'use strict';

/**
 * suggestion-ai-ranker — Prototype Fastify service
 *
 * POST /rank
 * Body: {
 *   places: <Foursquare place array>,
 *   context: { category, timeOfDay?, weather?, vibe? }
 * }
 *
 * Returns the places array re-ordered by Claude's ranking, plus Claude's reasoning.
 */

const fastify = require('fastify')({ logger: true });
const { rankPlaces, applyRanking } = require('./ranker');

fastify.post('/rank', {
  schema: {
    body: {
      type: 'object',
      required: ['places', 'context'],
      properties: {
        places: { type: 'array', minItems: 1 },
        context: {
          type: 'object',
          required: ['category'],
          properties: {
            category:  { type: 'string', enum: ['eat', 'see', 'do'] },
            timeOfDay: { type: 'string' },
            weather:   { type: 'string' },
            vibe:      { type: 'string' },
          },
        },
      },
    },
  },
}, async (request, reply) => {
  const { places, context } = request.body;

  try {
    const { rankedIds, reasoning } = await rankPlaces(places, context);
    const rankedPlaces = applyRanking(places, rankedIds);

    return { places: rankedPlaces, reasoning };
  } catch (err) {
    request.log.error(err, 'Ranking failed');
    // Graceful degradation: return original order if ranking fails
    return { places, reasoning: null, error: 'Ranking unavailable — returning original order.' };
  }
});

fastify.get('/health', async () => ({ status: 'ok' }));

async function main() {
  const config = require('./config');
  await fastify.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
