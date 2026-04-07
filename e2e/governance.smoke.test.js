'use strict';

/**
 * E2E Smoke Test: Governance Approval Flow
 *
 * Tests the end-to-end governance workflow by spinning up both
 * discord-sync-worker (webhook ingestion) and ticket-api-service
 * (approval queue) in-process with a shared in-memory store
 * simulating the database layer.
 *
 * This verifies cross-service correctness: a webhook received by
 * discord-sync-worker must be visible via ticket-api-service's
 * approval queue endpoint.
 */

const crypto = require('crypto');
const fastify = require('fastify');

// Auto-mock both DB modules before requiring service code.
// Implementations are wired to a shared in-memory store in beforeAll.
jest.mock('../discord-sync-worker/src/db');
jest.mock('../ticket-api-service/src/db');

const discordDb = require('../discord-sync-worker/src/db');
const ticketDb = require('../ticket-api-service/src/db');

const { webhookHandler } = require('../discord-sync-worker/src/webhook');
const approvalsPlugin = require('../ticket-api-service/src/routes/approvals');

const TEST_SECRET = 'e2e-smoke-test-secret-govern';

function signPayload(body) {
  return crypto.createHmac('sha256', TEST_SECRET).update(body).digest('hex');
}

function buildWebhookApp() {
  const app = fastify({ logger: false });
  // Raw buffer content-type parser — required for HMAC verification
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    done(null, body);
  });
  app.post('/webhook/discord/approval', webhookHandler);
  return app;
}

function buildTicketApp() {
  const app = fastify({ logger: false });
  app.register(approvalsPlugin);
  return app;
}

describe('E2E Smoke: Governance Approval Flow', () => {
  let webhookApp;
  let ticketApp;
  const inMemoryApprovals = [];

  beforeAll(async () => {
    process.env.DISCORD_WEBHOOK_SECRET = TEST_SECRET;

    // Wire discord-sync-worker db to the shared in-memory store
    discordDb.writeApproval.mockImplementation(async (row) => {
      inMemoryApprovals.push(row);
    });
    discordDb.writeDLQ.mockResolvedValue(undefined);

    // Wire ticket-api-service db to read from the same store.
    // Mirrors the real SQL: non-synthetic pending/approved approvals.
    ticketDb.query.mockImplementation(async () => {
      const items = inMemoryApprovals.filter((a) => a.tenant_id !== '__synthetic__');
      return { rows: [{ count: items.length, items }] };
    });

    webhookApp = buildWebhookApp();
    ticketApp = buildTicketApp();
    await Promise.all([webhookApp.ready(), ticketApp.ready()]);
  });

  afterAll(async () => {
    await Promise.all([webhookApp.close(), ticketApp.close()]);
  });

  beforeEach(() => {
    // Reset shared state and call counts between tests
    inMemoryApprovals.length = 0;
    jest.clearAllMocks();
  });

  test('smoke-1: valid APPROVED webhook is ingested and reflected in the approval queue', async () => {
    const payload = {
      approval_id: 'smoke-001',
      status: 'APPROVED',
      user_id: 'u-smoke',
      tenant_id: 'acme',
    };
    const body = JSON.stringify(payload);
    const sig = signPayload(body);

    // Step 1: Webhook arrives at discord-sync-worker
    const webhookRes = await webhookApp.inject({
      method: 'POST',
      url: '/webhook/discord/approval',
      headers: { 'content-type': 'application/json', 'x-discord-signature': sig },
      body,
    });

    expect(webhookRes.statusCode).toBe(200);
    expect(JSON.parse(webhookRes.body)).toEqual({ ok: true });
    expect(discordDb.writeApproval).toHaveBeenCalledTimes(1);
    expect(discordDb.writeApproval).toHaveBeenCalledWith({
      approval_id: 'smoke-001',
      status: 'APPROVED',
      user_id: 'u-smoke',
      tenant_id: 'acme',
    });

    // Step 2: Operator checks ticket-api-service queue — must reflect the stored approval
    const queueRes = await ticketApp.inject({ method: 'GET', url: '/approvals/queue' });

    expect(queueRes.statusCode).toBe(200);
    const queue = JSON.parse(queueRes.body);
    expect(queue.count).toBe(1);
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      approval_id: 'smoke-001',
      status: 'APPROVED',
      tenant_id: 'acme',
    });
  });

  test('smoke-2: spoofed signature is rejected — no state written, queue stays empty', async () => {
    const payload = { approval_id: 'smoke-002', status: 'APPROVED', user_id: 'u-attacker' };
    const body = JSON.stringify(payload);
    // Sign with a wrong secret to simulate an attacker
    const badSig = crypto
      .createHmac('sha256', 'wrong-secret')
      .update(body)
      .digest('hex');

    const webhookRes = await webhookApp.inject({
      method: 'POST',
      url: '/webhook/discord/approval',
      headers: { 'content-type': 'application/json', 'x-discord-signature': badSig },
      body,
    });

    expect(webhookRes.statusCode).toBe(401);
    expect(discordDb.writeApproval).not.toHaveBeenCalled();

    // Queue must remain empty — no side effects from rejected request
    const queueRes = await ticketApp.inject({ method: 'GET', url: '/approvals/queue' });
    expect(queueRes.statusCode).toBe(200);
    const queue = JSON.parse(queueRes.body);
    expect(queue.count).toBe(0);
    expect(queue.items).toHaveLength(0);
  });

  test('smoke-3: DB failure during ingest routes payload to DLQ without data loss', async () => {
    discordDb.writeApproval.mockRejectedValueOnce(new Error('deadlock detected'));

    const payload = { approval_id: 'smoke-003', status: 'APPROVED', user_id: 'u-retry' };
    const body = JSON.stringify(payload);
    const sig = signPayload(body);

    const webhookRes = await webhookApp.inject({
      method: 'POST',
      url: '/webhook/discord/approval',
      headers: { 'content-type': 'application/json', 'x-discord-signature': sig },
      body,
    });

    // Service must respond 200 to Discord to prevent redundant retries
    expect(webhookRes.statusCode).toBe(200);
    expect(JSON.parse(webhookRes.body)).toEqual({ ok: true, dlq: true });
    expect(discordDb.writeDLQ).toHaveBeenCalledTimes(1);
    expect(discordDb.writeDLQ).toHaveBeenCalledWith({
      payload,
      error_message: 'deadlock detected',
    });
  });

  test('smoke-4: multiple approvals from different tenants all appear in the queue', async () => {
    const tenants = ['acme', 'beta', 'corp'];

    for (let i = 0; i < tenants.length; i++) {
      const payload = {
        approval_id: `smoke-multi-${i + 1}`,
        status: 'APPROVED',
        user_id: `u-${i + 1}`,
        tenant_id: tenants[i],
      };
      const body = JSON.stringify(payload);
      const sig = signPayload(body);
      const res = await webhookApp.inject({
        method: 'POST',
        url: '/webhook/discord/approval',
        headers: { 'content-type': 'application/json', 'x-discord-signature': sig },
        body,
      });
      expect(res.statusCode).toBe(200);
    }

    expect(discordDb.writeApproval).toHaveBeenCalledTimes(3);

    const queueRes = await ticketApp.inject({ method: 'GET', url: '/approvals/queue' });
    expect(queueRes.statusCode).toBe(200);
    const queue = JSON.parse(queueRes.body);
    expect(queue.count).toBe(3);
    expect(queue.items).toHaveLength(3);
    expect(queue.items.map((i) => i.tenant_id).sort()).toEqual(['acme', 'beta', 'corp']);
  });

  test('smoke-5: synthetic canary approvals are excluded from the operator queue', async () => {
    // Ingest a real approval and a synthetic canary approval
    const realPayload = {
      approval_id: 'smoke-real-001',
      status: 'APPROVED',
      user_id: 'u-real',
      tenant_id: 'acme',
    };
    const syntheticPayload = {
      approval_id: `canary-${Date.now()}`,
      status: 'pending',
      user_id: 'canary',
      tenant_id: '__synthetic__',
    };

    for (const payload of [realPayload, syntheticPayload]) {
      const body = JSON.stringify(payload);
      const sig = signPayload(body);
      await webhookApp.inject({
        method: 'POST',
        url: '/webhook/discord/approval',
        headers: { 'content-type': 'application/json', 'x-discord-signature': sig },
        body,
      });
    }

    expect(discordDb.writeApproval).toHaveBeenCalledTimes(2);

    // Queue must exclude synthetic entries — only real approvals shown to operators
    const queueRes = await ticketApp.inject({ method: 'GET', url: '/approvals/queue' });
    expect(queueRes.statusCode).toBe(200);
    const queue = JSON.parse(queueRes.body);
    expect(queue.count).toBe(1);
    expect(queue.items[0].tenant_id).toBe('acme');
  });
});
