'use strict';

const crypto = require('crypto');
const fastify = require('fastify');

// Mock the db module so no real Postgres connection is needed
jest.mock('../src/db', () => ({
  writeApproval: jest.fn().mockResolvedValue(undefined),
  writeDLQ: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../src/db');
const { webhookHandler } = require('../src/webhook');

const TEST_SECRET = 'test-secret-abc123';

function signPayload(body, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(Buffer.isBuffer(body) ? body : Buffer.from(body));
  return hmac.digest('hex');
}

function buildApp() {
  const app = fastify({ logger: false });

  // Same content-type parser as index.js: parse application/json as raw buffer
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    done(null, body);
  });

  app.post('/webhook/discord/approval', webhookHandler);

  return app;
}

describe('Webhook integration tests', () => {
  let app;

  beforeAll(async () => {
    process.env.DISCORD_WEBHOOK_SECRET = TEST_SECRET;
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('1. Valid signature + APPROVED status → 200 + writes to DB', async () => {
    const payload = { approval_id: 'ap-001', status: 'APPROVED', user_id: 'u-123' };
    const bodyStr = JSON.stringify(payload);
    const sig = signPayload(bodyStr, TEST_SECRET);

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/discord/approval',
      headers: {
        'content-type': 'application/json',
        'x-discord-signature': sig,
      },
      body: bodyStr,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(db.writeApproval).toHaveBeenCalledTimes(1);
    expect(db.writeApproval).toHaveBeenCalledWith({
      approval_id: 'ap-001',
      status: 'APPROVED',
      user_id: 'u-123',
      tenant_id: 'default',
    });
  });

  test('2. Spoofed/invalid signature → 401 rejected', async () => {
    const payload = { approval_id: 'ap-001', status: 'APPROVED', user_id: 'u-123' };
    const bodyStr = JSON.stringify(payload);
    const wrongSig = signPayload(bodyStr, 'wrong-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/discord/approval',
      headers: {
        'content-type': 'application/json',
        'x-discord-signature': wrongSig,
      },
      body: bodyStr,
    });

    expect(response.statusCode).toBe(401);
    expect(db.writeApproval).not.toHaveBeenCalled();
  });

  test('3. Missing signature header → 401 rejected', async () => {
    const payload = { approval_id: 'ap-001', status: 'APPROVED', user_id: 'u-123' };
    const bodyStr = JSON.stringify(payload);

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/discord/approval',
      headers: {
        'content-type': 'application/json',
        // no x-discord-signature header
      },
      body: bodyStr,
    });

    expect(response.statusCode).toBe(401);
    expect(db.writeApproval).not.toHaveBeenCalled();
  });

  test('4. Valid signature + missing required fields → 400', async () => {
    const payload = { approval_id: 'ap-002', status: 'APPROVED' }; // missing user_id
    const bodyStr = JSON.stringify(payload);
    const sig = signPayload(bodyStr, TEST_SECRET);

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/discord/approval',
      headers: {
        'content-type': 'application/json',
        'x-discord-signature': sig,
      },
      body: bodyStr,
    });

    expect(response.statusCode).toBe(400);
  });

  test('5. Valid signature + DB deadlock/error → 200 + routed to DLQ', async () => {
    db.writeApproval.mockRejectedValueOnce(new Error('deadlock detected'));

    const payload = { approval_id: 'ap-003', status: 'APPROVED', user_id: 'u-456' };
    const bodyStr = JSON.stringify(payload);
    const sig = signPayload(bodyStr, TEST_SECRET);

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/discord/approval',
      headers: {
        'content-type': 'application/json',
        'x-discord-signature': sig,
      },
      body: bodyStr,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, dlq: true });
    expect(db.writeDLQ).toHaveBeenCalledTimes(1);
    expect(db.writeDLQ).toHaveBeenCalledWith({
      payload: payload,
      error_message: 'deadlock detected',
    });
  });
});
