'use strict';

const fastify = require('fastify');
const placesPlugin = require('../src/routes/places');

function buildApp() {
  const app = fastify({ logger: false });
  app.register(placesPlugin);
  return app;
}

describe('places-api-service unit tests', () => {
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
    delete process.env.FOURSQUARE_API_KEY;
  });

  describe('GET /health', () => {
    test('returns 200 with status ok', async () => {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
    });
  });

  describe('GET /places/search', () => {
    test('returns 503 when FOURSQUARE_API_KEY is not set', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/places/search?ll=35.6762,139.6503&cat=eat',
      });
      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body)).toMatchObject({ error: expect.stringContaining('FOURSQUARE_API_KEY') });
    });

    test('returns 400 when ll param is missing', async () => {
      process.env.FOURSQUARE_API_KEY = 'test-key';
      const response = await app.inject({
        method: 'GET',
        url: '/places/search?cat=eat',
      });
      expect(response.statusCode).toBe(400);
    });

    test('returns 400 when cat param is missing', async () => {
      process.env.FOURSQUARE_API_KEY = 'test-key';
      const response = await app.inject({
        method: 'GET',
        url: '/places/search?ll=35.6762,139.6503',
      });
      expect(response.statusCode).toBe(400);
    });

    test('returns 400 when cat is not a valid enum value', async () => {
      process.env.FOURSQUARE_API_KEY = 'test-key';
      const response = await app.inject({
        method: 'GET',
        url: '/places/search?ll=35.6762,139.6503&cat=sleep',
      });
      expect(response.statusCode).toBe(400);
    });

    test('returns 400 when ll has invalid format', async () => {
      process.env.FOURSQUARE_API_KEY = 'test-key';
      const response = await app.inject({
        method: 'GET',
        url: '/places/search?ll=not-a-coord&cat=eat',
      });
      expect(response.statusCode).toBe(400);
    });

    test('returns 200 and forwards Foursquare payload on success', async () => {
      process.env.FOURSQUARE_API_KEY = 'test-key';
      const fsqPayload = { results: [{ fsq_id: 'abc123', name: 'Ramen Shop' }] };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => fsqPayload,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/places/search?ll=35.6762,139.6503&cat=eat',
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(fsqPayload);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOpts] = global.fetch.mock.calls[0];
      expect(calledUrl).toContain('categories=13000');
      expect(calledUrl).toContain('radius=1500');
      expect(calledOpts.headers.Authorization).toBe('Bearer test-key');
    });

    test('accepts negative coordinates (southern/western hemisphere)', async () => {
      process.env.FOURSQUARE_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/places/search?ll=-33.8688,-70.6693&cat=see',
      });

      expect(response.statusCode).toBe(200);
      const [calledUrl] = global.fetch.mock.calls[0];
      expect(calledUrl).toContain('categories=16000');
      expect(calledUrl).toContain('radius=2500');
    });

    test('uses correct category and radius for "do"', async () => {
      process.env.FOURSQUARE_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await app.inject({
        method: 'GET',
        url: '/places/search?ll=51.5074,-0.1278&cat=do',
      });

      const [calledUrl] = global.fetch.mock.calls[0];
      expect(calledUrl).toContain('categories=10000%2C18000');
      expect(calledUrl).toContain('radius=3000');
    });

    test('returns 503 when fetch rejects with AbortError (timeout)', async () => {
      process.env.FOURSQUARE_API_KEY = 'test-key';
      global.fetch = jest.fn().mockRejectedValue(
        Object.assign(new Error('aborted'), { name: 'AbortError' })
      );

      const response = await app.inject({
        method: 'GET',
        url: '/places/search?ll=35.6762,139.6503&cat=eat',
      });

      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body)).toMatchObject({ error: expect.stringContaining('temporarily unavailable') });
    });

    test('returns 503 when fetch rejects with a network error', async () => {
      process.env.FOURSQUARE_API_KEY = 'test-key';
      global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      const response = await app.inject({
        method: 'GET',
        url: '/places/search?ll=35.6762,139.6503&cat=eat',
      });

      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body)).toMatchObject({ error: expect.stringContaining('temporarily unavailable') });
    });

    test('returns 502 when Foursquare API returns an error status', async () => {
      process.env.FOURSQUARE_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/places/search?ll=35.6762,139.6503&cat=eat',
      });

      expect(response.statusCode).toBe(502);
      expect(JSON.parse(response.body)).toMatchObject({ error: expect.stringContaining('429') });
    });
  });
});
