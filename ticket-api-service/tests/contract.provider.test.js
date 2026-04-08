'use strict';

/**
 * Contract Provider Verification: ticket-api-service
 *
 * Verifies that ticket-api-service satisfies every interaction defined in
 * contracts/governance-consumer--ticket-api-service.json. When a consumer
 * updates their contract expectations the assertions here automatically
 * reflect those changes — keeping provider and consumer in lock-step without
 * a running Pact broker.
 */

const path = require('path');
const http = require('http');
const EventEmitter = require('events');
const fastify = require('fastify');

jest.mock('../src/db', () => ({ query: jest.fn() }));
const db = require('../src/db');
const approvalsPlugin = require('../src/routes/approvals');

const contract = require('../../contracts/governance-consumer--ticket-api-service.json');

// ---------------------------------------------------------------------------
// Schema assertion helper
// ---------------------------------------------------------------------------

function assertMatchesSchema(value, schema, path = 'body') {
  if (schema.type === 'integer' || schema.type === 'number') {
    expect(typeof value).toBe('number');
    if (schema.minimum !== undefined) {
      expect(value).toBeGreaterThanOrEqual(schema.minimum);
    }
  } else if (schema.type === 'string') {
    expect(typeof value).toBe('string');
    if (schema.enum) expect(schema.enum).toContain(value);
    if (schema.value !== undefined) expect(value).toBe(schema.value);
  } else if (schema.type === 'boolean') {
    expect(typeof value).toBe('boolean');
    if (schema.value !== undefined) expect(value).toBe(schema.value);
  } else if (schema.type === 'array') {
    expect(Array.isArray(value)).toBe(true);
  } else if (schema.type === 'object') {
    expect(value !== null && typeof value === 'object').toBe(true);
  }
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function buildApp() {
  const app = fastify({ logger: false });
  app.register(approvalsPlugin);
  return app;
}

// ---------------------------------------------------------------------------
// Helpers for mocking the internal http.get used by /sync-status
// ---------------------------------------------------------------------------

function mockInternalQueueResponse(count) {
  const mockReq = { on: jest.fn().mockReturnThis(), destroy: jest.fn() };
  jest.spyOn(http, 'get').mockImplementationOnce((_url, _opts, callback) => {
    const mockRes = new EventEmitter();
    setImmediate(() => {
      mockRes.emit('data', JSON.stringify({ count }));
      mockRes.emit('end');
    });
    callback(mockRes);
    return mockReq;
  });
}

function mockInternalQueueError(message) {
  const mockReq = { on: jest.fn().mockReturnThis(), destroy: jest.fn() };
  jest.spyOn(http, 'get').mockImplementationOnce((_url, _opts, _callback) => {
    const handlers = {};
    mockReq.on.mockImplementation((event, handler) => {
      handlers[event] = handler;
      return mockReq;
    });
    setImmediate(() => handlers.error && handlers.error(new Error(message)));
    return mockReq;
  });
}

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
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // GET /approvals/queue
  // -------------------------------------------------------------------------

  describe('interaction: fetches pending approvals queue', () => {
    const interaction = contract.interactions.find(
      (i) => i.description === 'fetches pending approvals queue'
    );

    test('returns a response matching the contracted schema', async () => {
      const items = [
        { id: 1, approval_id: 'ap-01', status: 'pending', tenant_id: 'acme' },
        { id: 2, approval_id: 'ap-02', status: 'pending', tenant_id: 'beta' },
      ];
      db.query.mockResolvedValueOnce({ rows: [{ count: 2, items }] });

      const response = await app.inject({
        method: interaction.request.method,
        url: interaction.request.path,
      });

      expect(response.statusCode).toBe(interaction.response.status);
      const body = JSON.parse(response.body);

      for (const [field, schema] of Object.entries(interaction.response.body)) {
        assertMatchesSchema(body[field], schema, field);
      }

      // Semantic: count must equal items length
      expect(body.count).toBe(body.items.length);
    });

    test('returns count 0 and empty array when queue is empty', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ count: 0, items: [] }] });

      const response = await app.inject({
        method: interaction.request.method,
        url: interaction.request.path,
      });

      expect(response.statusCode).toBe(interaction.response.status);
      const body = JSON.parse(response.body);
      assertMatchesSchema(body.count, interaction.response.body.count, 'count');
      assertMatchesSchema(body.items, interaction.response.body.items, 'items');
      expect(body.count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // GET /approvals/audit-log
  // -------------------------------------------------------------------------

  describe('interaction: fetches approval audit log', () => {
    const interaction = contract.interactions.find(
      (i) => i.description === 'fetches approval audit log'
    );

    test('returns a response matching the contracted schema', async () => {
      const rows = [
        { id: 10, approval_id: 'ap-10', status: 'APPROVED', tenant_id: 'acme', created_at: '2026-04-01T00:00:00Z' },
      ];
      db.query.mockResolvedValueOnce({ rows });

      const response = await app.inject({
        method: interaction.request.method,
        url: interaction.request.path,
      });

      expect(response.statusCode).toBe(interaction.response.status);
      const body = JSON.parse(response.body);
      assertMatchesSchema(body.items, interaction.response.body.items, 'items');
    });

    test('returns empty items array when no records exist', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const response = await app.inject({
        method: interaction.request.method,
        url: interaction.request.path,
      });

      expect(response.statusCode).toBe(interaction.response.status);
      expect(JSON.parse(response.body)).toEqual({ items: [] });
    });
  });

  // -------------------------------------------------------------------------
  // GET /sync-status
  // -------------------------------------------------------------------------

  describe('interaction: fetches sync status', () => {
    const interaction = contract.interactions.find(
      (i) => i.description === 'fetches sync status'
    );

    test('returns 200 with sync=ok when DB and API counts match', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ count: 3 }] });
      mockInternalQueueResponse(3);

      const response = await app.inject({
        method: interaction.request.method,
        url: interaction.request.path,
      });

      expect(interaction.response.status_one_of).toContain(response.statusCode);
      const body = JSON.parse(response.body);
      assertMatchesSchema(body.sync, interaction.response.body.sync, 'sync');
      assertMatchesSchema(body.db_count, interaction.response.body.db_count, 'db_count');
      expect(body.sync).toBe('ok');
    });

    test('returns 503 with sync=drift when DB and API counts differ', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ count: 5 }] });
      mockInternalQueueResponse(3);

      const response = await app.inject({
        method: interaction.request.method,
        url: interaction.request.path,
      });

      expect(interaction.response.status_one_of).toContain(response.statusCode);
      const body = JSON.parse(response.body);
      assertMatchesSchema(body.sync, interaction.response.body.sync, 'sync');
      assertMatchesSchema(body.db_count, interaction.response.body.db_count, 'db_count');
      expect(body.sync).toBe('drift');
    });

    test('returns 503 with sync=error when internal API call fails', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ count: 2 }] });
      mockInternalQueueError('connection refused');

      const response = await app.inject({
        method: interaction.request.method,
        url: interaction.request.path,
      });

      expect(interaction.response.status_one_of).toContain(response.statusCode);
      const body = JSON.parse(response.body);
      assertMatchesSchema(body.sync, interaction.response.body.sync, 'sync');
      assertMatchesSchema(body.db_count, interaction.response.body.db_count, 'db_count');
      expect(body.sync).toBe('error');
    });
  });

  // -------------------------------------------------------------------------
  // POST /break-glass/audit — success
  // -------------------------------------------------------------------------

  describe('interaction: submits a break-glass audit entry', () => {
    const interaction = contract.interactions.find(
      (i) => i.description === 'submits a break-glass audit entry'
    );

    test('returns 200 with contracted body shape on valid request', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 99 }] });

      const response = await app.inject({
        method: interaction.request.method,
        url: interaction.request.path,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(interaction.request.body),
      });

      expect(response.statusCode).toBe(interaction.response.status);
      const body = JSON.parse(response.body);
      assertMatchesSchema(body.ok, interaction.response.body.ok, 'ok');
      assertMatchesSchema(body.id, interaction.response.body.id, 'id');
    });
  });

  // -------------------------------------------------------------------------
  // POST /break-glass/audit — validation failure
  // -------------------------------------------------------------------------

  describe('interaction: rejects break-glass entry with missing fields', () => {
    const interaction = contract.interactions.find(
      (i) => i.description === 'rejects break-glass entry with missing fields'
    );

    test('returns 400 with an error string in the body', async () => {
      const response = await app.inject({
        method: interaction.request.method,
        url: interaction.request.path,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(interaction.request.body),
      });

      expect(response.statusCode).toBe(interaction.response.status);
      const body = JSON.parse(response.body);
      assertMatchesSchema(body.error, interaction.response.body.error, 'error');
    });
  });
});
