'use strict';

/**
 * Contract Consumer Test: governance-consumer → ticket-api-service
 *
 * Defines what governance consumers (SRE monitoring tools, break-glass
 * operators, and CI pipelines) need from ticket-api-service. If any API
 * shape changes break these consumer expectations, this test catches it
 * before a deployment.
 *
 * Run alongside the e2e smoke tests as part of the contract gates in CI.
 */

const crypto = require('crypto');
const fastify = require('fastify');

jest.mock('../ticket-api-service/src/db');
const ticketDb = require('../ticket-api-service/src/db');
const approvalsPlugin = require('../ticket-api-service/src/routes/approvals');

const contract = require('../contracts/governance-consumer--ticket-api-service.json');

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function buildTicketApp() {
  const app = fastify({ logger: false });
  app.register(approvalsPlugin);
  return app;
}

// ---------------------------------------------------------------------------
// Schema assertion helper
// ---------------------------------------------------------------------------

function assertBodyMatchesSchema(body, schema) {
  for (const [field, fieldSchema] of Object.entries(schema)) {
    const value = body[field];
    if (fieldSchema.type === 'integer' || fieldSchema.type === 'number') {
      expect(typeof value).toBe('number');
      if (fieldSchema.minimum !== undefined) {
        expect(value).toBeGreaterThanOrEqual(fieldSchema.minimum);
      }
    } else if (fieldSchema.type === 'string') {
      expect(typeof value).toBe('string');
      if (fieldSchema.enum) expect(fieldSchema.enum).toContain(value);
      if (fieldSchema.value !== undefined) expect(value).toBe(fieldSchema.value);
    } else if (fieldSchema.type === 'boolean') {
      expect(typeof value).toBe('boolean');
      if (fieldSchema.value !== undefined) expect(value).toBe(fieldSchema.value);
    } else if (fieldSchema.type === 'array') {
      expect(Array.isArray(value)).toBe(true);
    }
  }
}

// ---------------------------------------------------------------------------
// Contract consumer verification (governance consumer perspective)
// ---------------------------------------------------------------------------

describe(`Contract consumer test: ${contract.consumer} consuming ${contract.provider}`, () => {
  let app;

  beforeAll(async () => {
    app = buildTicketApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // GET /approvals/queue
  // -------------------------------------------------------------------------

  describe('consumer expectation: GET /approvals/queue returns queue state', () => {
    const interaction = contract.interactions.find(
      (i) => i.description === 'fetches pending approvals queue'
    );

    test('response includes a numeric count >= 0', async () => {
      ticketDb.query.mockResolvedValueOnce({ rows: [{ count: 1, items: [{ id: 1 }] }] });

      const response = await app.inject({ method: 'GET', url: '/approvals/queue' });
      expect(response.statusCode).toBe(interaction.response.status);

      const body = JSON.parse(response.body);
      assertBodyMatchesSchema(body, interaction.response.body);
    });

    test('consumer can handle an empty queue without errors', async () => {
      ticketDb.query.mockResolvedValueOnce({ rows: [{ count: 0, items: [] }] });

      const response = await app.inject({ method: 'GET', url: '/approvals/queue' });
      const body = JSON.parse(response.body);

      // Consumer must not treat count=0 as an error — it is a valid zero-state
      expect(body.count).toBe(0);
      expect(body.items).toEqual([]);
    });

    test('consumer expects items to be an array, not null or undefined', async () => {
      ticketDb.query.mockResolvedValueOnce({ rows: [{ count: 0, items: [] }] });

      const response = await app.inject({ method: 'GET', url: '/approvals/queue' });
      const body = JSON.parse(response.body);

      expect(Array.isArray(body.items)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // GET /approvals/audit-log
  // -------------------------------------------------------------------------

  describe('consumer expectation: GET /approvals/audit-log returns audit trail', () => {
    const interaction = contract.interactions.find(
      (i) => i.description === 'fetches approval audit log'
    );

    test('response wraps rows in an "items" array', async () => {
      const rows = [
        { id: 5, status: 'APPROVED', tenant_id: 'acme', created_at: '2026-04-01T00:00:00Z' },
      ];
      ticketDb.query.mockResolvedValueOnce({ rows });

      const response = await app.inject({ method: 'GET', url: '/approvals/audit-log' });
      expect(response.statusCode).toBe(interaction.response.status);

      const body = JSON.parse(response.body);
      assertBodyMatchesSchema(body, interaction.response.body);
      expect(body.items).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // POST /break-glass/audit
  // -------------------------------------------------------------------------

  describe('consumer expectation: POST /break-glass/audit creates an audit entry', () => {
    const successInteraction = contract.interactions.find(
      (i) => i.description === 'submits a break-glass audit entry'
    );
    const errorInteraction = contract.interactions.find(
      (i) => i.description === 'rejects break-glass entry with missing fields'
    );

    test('valid payload returns { ok: true, id: <integer> }', async () => {
      ticketDb.query.mockResolvedValueOnce({ rows: [{ id: 7 }] });

      const response = await app.inject({
        method: 'POST',
        url: '/break-glass/audit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(successInteraction.request.body),
      });

      expect(response.statusCode).toBe(successInteraction.response.status);
      const body = JSON.parse(response.body);
      assertBodyMatchesSchema(body, successInteraction.response.body);
      expect(body.ok).toBe(true);
      expect(Number.isInteger(body.id)).toBe(true);
    });

    test('missing fields return 400 with an error message (consumer must surface this)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/break-glass/audit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(errorInteraction.request.body),
      });

      expect(response.statusCode).toBe(errorInteraction.response.status);
      const body = JSON.parse(response.body);
      expect(typeof body.error).toBe('string');
    });
  });
});
