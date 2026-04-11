'use strict';

/**
 * Security tests for places-api-service:
 * - IP-based rate limiting
 * - Strict CORS origin enforcement
 */

const fastify = require('fastify');
const placesPlugin = require('../src/routes/places');

// Re-require the CORS/rate-limit logic by loading the module under test.
// Because the rate limiter and CORS hook live in src/index.js (the server
// bootstrap), we build a minimal test app that reproduces the same hooks.

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60000;

function buildSecureApp({ corsOrigin } = {}) {
  const app = fastify({ logger: false });

  // Mirror the rate-limit store setup from src/index.js
  const rateLimitStore = new Map();

  function isRateLimited(ip) {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    let timestamps = rateLimitStore.get(ip);
    if (!timestamps) {
      timestamps = [];
      rateLimitStore.set(ip, timestamps);
    }
    while (timestamps.length > 0 && timestamps[0] < windowStart) {
      timestamps.shift();
    }
    if (timestamps.length >= RATE_LIMIT_MAX) return true;
    timestamps.push(now);
    return false;
  }

  const allowedOrigins = corsOrigin
    ? new Set(corsOrigin.split(',').map((o) => o.trim()))
    : null;

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;

    if (allowedOrigins) {
      if (origin && allowedOrigins.has(origin)) {
        reply.header('Access-Control-Allow-Origin', origin);
        reply.header('Vary', 'Origin');
      }
    } else {
      reply.header('Access-Control-Allow-Origin', '*');
    }
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
      reply.code(204).send();
      return;
    }

    const ip = request.ip;
    if (isRateLimited(ip)) {
      const retryAfter = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);
      reply
        .code(429)
        .header('Retry-After', String(retryAfter))
        .send({ error: 'Too many requests — please try again shortly.' });
    }
  });

  app.register(placesPlugin);
  return app;
}

// ---------------------------------------------------------------------------
// Rate limiting tests
// ---------------------------------------------------------------------------

describe('IP-based rate limiting', () => {
  let app;

  beforeAll(async () => {
    app = buildSecureApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  test('allows requests up to the limit', async () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        remoteAddress: '10.0.0.1',
      });
      expect(res.statusCode).not.toBe(429);
    }
  });

  test('returns 429 after limit is exceeded for the same IP', async () => {
    // The previous test consumed all RATE_LIMIT_MAX tokens for 10.0.0.1;
    // this next request must be throttled.
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: '10.0.0.1',
    });
    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body)).toMatchObject({
      error: expect.stringContaining('Too many requests'),
    });
  });

  test('returns Retry-After header on 429', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: '10.0.0.1',
    });
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  test('different IPs have independent limits', async () => {
    // 10.0.0.2 has not been used yet — should succeed
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: '10.0.0.2',
    });
    expect(res.statusCode).toBe(200);
  });

  test('OPTIONS preflight is not rate-limited', async () => {
    // Use a fresh IP to ensure we start clean; CORS preflight must never be blocked.
    const rateLimitedApp = buildSecureApp();
    await rateLimitedApp.ready();

    // Exhaust the rate limit using GET requests
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      await rateLimitedApp.inject({
        method: 'GET',
        url: '/health',
        remoteAddress: '10.0.0.3',
      });
    }

    // OPTIONS should still succeed (rate check is skipped)
    const res = await rateLimitedApp.inject({
      method: 'OPTIONS',
      url: '/health',
      remoteAddress: '10.0.0.3',
      headers: { origin: 'https://example.com' },
    });
    expect(res.statusCode).toBe(204);

    await rateLimitedApp.close();
  });
});

// ---------------------------------------------------------------------------
// Strict CORS tests
// ---------------------------------------------------------------------------

describe('Strict CORS origin enforcement', () => {
  describe('when CORS_ORIGIN is configured', () => {
    let app;

    beforeAll(async () => {
      app = buildSecureApp({
        corsOrigin: 'https://gabeshep.github.io,https://staging.unko.app',
      });
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    test('sets Access-Control-Allow-Origin for an allowed origin', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'https://gabeshep.github.io' },
        remoteAddress: '10.1.0.1',
      });
      expect(res.headers['access-control-allow-origin']).toBe('https://gabeshep.github.io');
      expect(res.headers['vary']).toContain('Origin');
    });

    test('sets Access-Control-Allow-Origin for the staging origin', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'https://staging.unko.app' },
        remoteAddress: '10.1.0.2',
      });
      expect(res.headers['access-control-allow-origin']).toBe('https://staging.unko.app');
    });

    test('does not set Access-Control-Allow-Origin for an unlisted origin', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'https://malicious-site.example.com' },
        remoteAddress: '10.1.0.3',
      });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    test('does not set Access-Control-Allow-Origin when no Origin header is sent', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        remoteAddress: '10.1.0.4',
      });
      // No origin header on the request — server should not echo any origin
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('when CORS_ORIGIN is not configured (development fallback)', () => {
    let app;

    beforeAll(async () => {
      app = buildSecureApp(); // no corsOrigin
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    test('falls back to wildcard Access-Control-Allow-Origin', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'http://localhost:3000' },
        remoteAddress: '10.2.0.1',
      });
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });
  });
});
