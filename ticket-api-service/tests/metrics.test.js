'use strict';

const { EventEmitter } = require('events');
const fastify = require('fastify');

// Mock `db` so no real Postgres connection is needed.
jest.mock('../src/db', () => ({
  query: jest.fn(),
}));

// Mock `http` so the internal call to /approvals/queue doesn't hit a real
// server.  We spread the real module so Fastify's own http.createServer works.
jest.mock('http', () => ({
  ...jest.requireActual('http'),
  get: jest.fn(),
}));

const db = require('../src/db');
const http = require('http');
const metricsPlugin = require('../src/routes/metrics');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = fastify({ logger: false });
  app.register(metricsPlugin);
  return app;
}

/**
 * Configure the http.get mock to call back with a fake response that emits
 * `data` + `end` carrying the provided body string.
 */
function mockHttpGet(bodyStr, statusCode = 200) {
  http.get.mockImplementationOnce((_url, _opts, callback) => {
    const fakeRes = new EventEmitter();
    fakeRes.statusCode = statusCode;

    setImmediate(() => {
      fakeRes.emit('data', bodyStr);
      fakeRes.emit('end');
    });

    const fakeReq = new EventEmitter();
    fakeReq.destroy = jest.fn();
    callback(fakeRes);
    return fakeReq;
  });
}

function mockHttpGetError(errMessage) {
  http.get.mockImplementationOnce((_url, _opts, _callback) => {
    const fakeReq = new EventEmitter();
    fakeReq.destroy = jest.fn();
    setImmediate(() => fakeReq.emit('error', new Error(errMessage)));
    return fakeReq;
  });
}

function mockHttpGetTimeout() {
  http.get.mockImplementationOnce((_url, _opts, _callback) => {
    const fakeReq = new EventEmitter();
    fakeReq.destroy = jest.fn();
    setImmediate(() => fakeReq.emit('timeout'));
    return fakeReq;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /metrics', () => {
  let app;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(() => app.close());

  beforeEach(() => jest.clearAllMocks());

  test('returns 200 with Prometheus text content-type', async () => {
    // Query 1: pending DB count
    db.query.mockResolvedValueOnce({ rows: [{ count: 3 }] });
    // http.get: /approvals/queue response
    mockHttpGet(JSON.stringify({ count: 3, items: [] }));
    // Query 2: canary last success epoch
    db.query.mockResolvedValueOnce({ rows: [{ ts: 1712000000 }] });

    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  test('metrics output contains all three gauge names', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ count: 5 }] });
    mockHttpGet(JSON.stringify({ count: 5, items: [] }));
    db.query.mockResolvedValueOnce({ rows: [{ ts: 1712000000 }] });

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;

    expect(body).toContain('approvals_pending_db_count');
    expect(body).toContain('approvals_queue_api_count');
    expect(body).toContain('approvals_canary_last_success_seconds');
  });

  test('pending DB count gauge reflects the value from the DB query', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ count: 7 }] });
    mockHttpGet(JSON.stringify({ count: 7, items: [] }));
    db.query.mockResolvedValueOnce({ rows: [{ ts: 0 }] });

    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.body).toMatch(/approvals_pending_db_count\s+7/);
  });

  test('sets queueApiCount to -1 when /approvals/queue returns unparseable JSON', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ count: 2 }] });
    mockHttpGet('not-valid-json');
    db.query.mockResolvedValueOnce({ rows: [{ ts: 0 }] });

    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/approvals_queue_api_count\s+-1/);
  });

  test('sets queueApiCount to -1 when http.get emits an error', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    mockHttpGetError('ECONNREFUSED');
    db.query.mockResolvedValueOnce({ rows: [{ ts: 0 }] });

    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/approvals_queue_api_count\s+-1/);
  });

  test('sets queueApiCount to -1 and destroys request on timeout', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    const destroySpy = jest.fn();
    http.get.mockImplementationOnce((_url, _opts, _callback) => {
      const fakeReq = new EventEmitter();
      fakeReq.destroy = destroySpy;
      setImmediate(() => fakeReq.emit('timeout'));
      return fakeReq;
    });
    db.query.mockResolvedValueOnce({ rows: [{ ts: 0 }] });

    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/approvals_queue_api_count\s+-1/);
    expect(destroySpy).toHaveBeenCalled();
  });

  test('sets canaryLastSuccess to 0 when DB returns null ts', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    mockHttpGet(JSON.stringify({ count: 0, items: [] }));
    db.query.mockResolvedValueOnce({ rows: [{ ts: null }] });

    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/approvals_canary_last_success_seconds\s+0/);
  });

  test('propagates DB errors as 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db connection lost'));

    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(500);
  });
});
