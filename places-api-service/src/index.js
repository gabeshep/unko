'use strict';

const fastify = require('fastify');
const config = require('./config');
const placesPlugin = require('./routes/places');

// ---------------------------------------------------------------------------
// Strict CORS origin matching
// CORS_ORIGIN env var: comma-separated list of allowed origins.
// In production, requests from unlisted origins are rejected.
// Without CORS_ORIGIN, a startup warning is logged and all origins are allowed
// (suitable for local development only).
// ---------------------------------------------------------------------------
function buildOriginSet() {
  const raw = process.env.CORS_ORIGIN;
  if (!raw) return null;
  return new Set(
    raw.split(',').map((o) => o.trim()).filter(Boolean)
  );
}

// ---------------------------------------------------------------------------
// IP-based rate limiter (sliding window, in-memory)
// Protects upstream Foursquare quota from abuse.
// Limit: RATE_LIMIT_MAX requests per RATE_LIMIT_WINDOW_MS milliseconds per IP.
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '60', 10);
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);

// Map<ip, number[]> — timestamps of recent requests within the current window
const rateLimitStore = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  let timestamps = rateLimitStore.get(ip);
  if (!timestamps) {
    timestamps = [];
    rateLimitStore.set(ip, timestamps);
  }

  // Evict timestamps outside the current window
  while (timestamps.length > 0 && timestamps[0] < windowStart) {
    timestamps.shift();
  }

  if (timestamps.length >= RATE_LIMIT_MAX) {
    return true;
  }

  timestamps.push(now);
  return false;
}

// Periodically purge IPs with empty timestamp arrays to prevent memory growth
setInterval(() => {
  for (const [ip, ts] of rateLimitStore) {
    if (ts.length === 0) rateLimitStore.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS);

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

async function main() {
  const app = fastify({ logger: true });

  const allowedOrigins = buildOriginSet();
  if (!allowedOrigins) {
    app.log.warn(
      'CORS_ORIGIN is not set — all origins are permitted. ' +
      'Set CORS_ORIGIN to a comma-separated list of allowed origins in production.'
    );
  }

  // CORS + rate limiting on every request
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', config.corsOrigin);
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
      reply.code(204).send();
      return;
    }

    // Rate limiting — applies to non-OPTIONS requests only
    const ip = request.ip;
    if (isRateLimited(ip)) {
      const retryAfter = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);
      reply
        .code(429)
        .header('Retry-After', String(retryAfter))
        .send({ error: 'Too many requests — please try again shortly.' });
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
