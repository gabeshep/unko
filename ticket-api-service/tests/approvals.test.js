'use strict';

const fastify = require('fastify');

jest.mock('../src/db', () => ({
  query: jest.fn(),
}));

const db = require('../src/db');
const approvalsPlugin = require('../src/routes/approvals');

function buildApp() {
  const app = fastify({ logger: false });
  app.register(approvalsPlugin);
  return app;
}

describe('ticket-api-service approvals routes', () => {
  let app;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /approvals/queue', () => {
    test('returns count and items from DB', async () => {
      const items = [{ id: 1, status: 'pending', tenant_id: 'acme' }];
      db.query.mockResolvedValueOnce({ rows: [{ count: 1, items }] });

      const response = await app.inject({ method: 'GET', url: '/approvals/queue' });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ count: 1, items });
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('returns count 0 and empty array when queue is empty', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ count: 0, items: [] }] });

      const response = await app.inject({ method: 'GET', url: '/approvals/queue' });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ count: 0, items: [] });
    });

    test('propagates DB errors as 500', async () => {
      db.query.mockRejectedValueOnce(new Error('connection refused'));

      const response = await app.inject({ method: 'GET', url: '/approvals/queue' });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('GET /approvals/audit-log', () => {
    test('returns list of approval rows', async () => {
      const rows = [
        { id: 10, status: 'APPROVED', tenant_id: 'acme', created_at: '2026-04-01T00:00:00Z' },
        { id: 9, status: 'DENIED', tenant_id: 'beta', created_at: '2026-03-31T00:00:00Z' },
      ];
      db.query.mockResolvedValueOnce({ rows });

      const response = await app.inject({ method: 'GET', url: '/approvals/audit-log' });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ items: rows });
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('returns empty items array when no records exist', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await app.inject({ method: 'GET', url: '/approvals/audit-log' });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ items: [] });
    });
  });

  describe('POST /break-glass/audit', () => {
    const validBody = {
      payload_hash: 'sha256-abc',
      sre_key_id: 'sre-key-1',
      sre_identity: 'alice@example.com',
      release_eng_key_id: 're-key-2',
      release_eng_identity: 'bob@example.com',
      shadow_mode: false,
    };

    test('returns 200 with id on valid request', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 42 }] });

      const response = await app.inject({
        method: 'POST',
        url: '/break-glass/audit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validBody),
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ ok: true, id: 42 });
      expect(db.query).toHaveBeenCalledTimes(1);
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/INSERT INTO break_glass_audit_log/);
      expect(params).toEqual([
        'sha256-abc',
        'sre-key-1',
        'alice@example.com',
        're-key-2',
        'bob@example.com',
        false,
      ]);
    });

    test('returns 400 when a required field is missing', async () => {
      const { sre_key_id: _omitted, ...incomplete } = validBody;

      const response = await app.inject({
        method: 'POST',
        url: '/break-glass/audit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(incomplete),
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toMatchObject({ error: 'Missing required fields' });
      expect(db.query).not.toHaveBeenCalled();
    });

    test('returns 400 when body is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/break-glass/audit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.statusCode).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
    });

    test('propagates DB errors as 500', async () => {
      db.query.mockRejectedValueOnce(new Error('unique violation'));

      const response = await app.inject({
        method: 'POST',
        url: '/break-glass/audit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validBody),
      });

      expect(response.statusCode).toBe(500);
    });
  });
});
