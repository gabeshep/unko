'use strict';

/**
 * Contract Provider Verification: places-api-service
 *
 * Verifies that places-api-service satisfies every interaction defined in
 * contracts/ranker-consumer--places-api-service.json. The suggestion-ai-ranker
 * service depends on specific fields (fsq_id, name, categories, location) being
 * present in every place object; breaking the shape breaks the AI ranking pipeline.
 */

const path = require('path');
const fastify = require('fastify');
const placesPlugin = require('../src/routes/places');

const contract = require('../../contracts/ranker-consumer--places-api-service.json');

// ---------------------------------------------------------------------------
// Schema assertion helper
// ---------------------------------------------------------------------------

function assertMatchesSchema(value, schema, label = '') {
  if (!schema || !schema.type) return;
  if (schema.type === 'string') {
    expect(typeof value).toBe('string');
    if (schema.value !== undefined) expect(value).toBe(schema.value);
    if (schema.enum) expect(schema.enum).toContain(value);
  } else if (schema.type === 'array') {
    expect(Array.isArray(value)).toBe(true);
    if (schema.items) {
      for (const item of value) {
        if (schema.items.required_properties) {
          for (const prop of schema.items.required_properties) {
            expect(item).toHaveProperty(prop);
          }
        }
        if (schema.items.properties) {
          for (const [field, fieldSchema] of Object.entries(schema.items.properties)) {
            if (item[field] !== undefined && item[field] !== null) {
              assertMatchesSchema(item[field], fieldSchema, `${label}.${field}`);
            }
          }
        }
      }
    }
  } else if (schema.type === 'object') {
    expect(value !== null && typeof value === 'object').toBe(true);
  }
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function buildApp() {
  const app = fastify({ logger: false });
  app.register(placesPlugin);
  return app;
}

// ---------------------------------------------------------------------------
// Representative Foursquare response used across interaction tests
// ---------------------------------------------------------------------------

const FSQ_PLACE_FIXTURE = {
  fsq_id: 'abc123',
  name: 'Ramen Shop',
  categories: [{ id: 13236, name: 'Ramen Restaurant' }],
  geocodes: { main: { latitude: 35.6762, longitude: 139.6503 } },
  location: {
    address: '1-1 Shinjuku',
    formatted_address: '1-1 Shinjuku, Tokyo, Japan',
  },
  distance: 120,
};

// ---------------------------------------------------------------------------
// Contract provider verification
// ---------------------------------------------------------------------------

describe(`Contract provider verification: ${contract.provider} satisfies ${contract.consumer}`, () => {
  let app;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.FOURSQUARE_API_KEY = 'test-contract-key';
  });

  afterEach(() => {
    delete process.env.FOURSQUARE_API_KEY;
  });

  // -------------------------------------------------------------------------
  // GET /places/search — eat category
  // -------------------------------------------------------------------------

  describe('interaction: fetches eat places by location', () => {
    const interaction = contract.interactions.find(
      (i) => i.description === 'fetches eat places by location'
    );

    test('returns 200 with place objects matching the contracted schema', async () => {
      const fsqResponse = { results: [FSQ_PLACE_FIXTURE] };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => fsqResponse,
      });

      const { ll, cat } = interaction.request.query;
      const response = await app.inject({
        method: interaction.request.method,
        url: `${interaction.request.path}?ll=${ll}&cat=${cat}`,
      });

      expect(response.statusCode).toBe(interaction.response.status);
      const body = JSON.parse(response.body);
      assertMatchesSchema(body.results, interaction.response.body.results, 'results');
    });

    test('contracted example_response place has all fields needed by summarizePlaces()', () => {
      // Verify the contract's own example matches the ranker's field expectations:
      // summarizePlaces() accesses: fsq_id, name, categories[0].name, distance,
      // location.formatted_address / location.address
      const examplePlace = interaction.example_response.results[0];

      expect(examplePlace).toHaveProperty('fsq_id');
      expect(typeof examplePlace.fsq_id).toBe('string');

      expect(examplePlace).toHaveProperty('name');
      expect(typeof examplePlace.name).toBe('string');

      expect(Array.isArray(examplePlace.categories)).toBe(true);
      expect(examplePlace.categories[0]).toHaveProperty('name');

      expect(examplePlace).toHaveProperty('location');
      const loc = examplePlace.location;
      const hasAddress =
        typeof loc.formatted_address === 'string' || typeof loc.address === 'string';
      expect(hasAddress).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // GET /places/search — see category with open_now filter
  // -------------------------------------------------------------------------

  describe('interaction: fetches see places by location with open_now filter', () => {
    const interaction = contract.interactions.find(
      (i) => i.description === 'fetches see places by location with open_now filter'
    );

    test('returns 200 and passes open_now param to upstream', async () => {
      const seePlace = { ...FSQ_PLACE_FIXTURE, fsq_id: 'see001', name: 'Tokyo Tower' };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [seePlace] }),
      });

      const { ll, cat, open_now } = interaction.request.query;
      const response = await app.inject({
        method: interaction.request.method,
        url: `${interaction.request.path}?ll=${ll}&cat=${cat}&open_now=${open_now}`,
      });

      expect(response.statusCode).toBe(interaction.response.status);
      const body = JSON.parse(response.body);
      assertMatchesSchema(body.results, interaction.response.body.results, 'results');

      // Verify open_now was forwarded to Foursquare
      const [calledUrl] = global.fetch.mock.calls[0];
      expect(calledUrl).toContain('open_now=true');
    });
  });

  // -------------------------------------------------------------------------
  // GET /places/search — invalid category
  // -------------------------------------------------------------------------

  describe('interaction: returns 400 for invalid category', () => {
    const interaction = contract.interactions.find(
      (i) => i.description === 'returns 400 for invalid category'
    );

    test('returns 400 when cat is not in [eat, see, do]', async () => {
      const { ll, cat } = interaction.request.query;
      const response = await app.inject({
        method: interaction.request.method,
        url: `${interaction.request.path}?ll=${ll}&cat=${cat}`,
      });

      expect(response.statusCode).toBe(interaction.response.status);
    });
  });

  // -------------------------------------------------------------------------
  // GET /health
  // -------------------------------------------------------------------------

  describe('interaction: health check returns ok', () => {
    const interaction = contract.interactions.find(
      (i) => i.description === 'health check returns ok'
    );

    test('returns 200 with { status: "ok" }', async () => {
      const response = await app.inject({
        method: interaction.request.method,
        url: interaction.request.path,
      });

      expect(response.statusCode).toBe(interaction.response.status);
      const body = JSON.parse(response.body);
      assertMatchesSchema(body.status, interaction.response.body.status, 'status');
    });
  });
});
