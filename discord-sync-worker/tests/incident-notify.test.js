'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const fastify = require('fastify');

// Mock `https` to prevent real outbound Discord requests.
jest.mock('https', () => ({
  request: jest.fn(),
}));

const https = require('https');
const { incidentNotifyHandler } = require('../src/incident-notify');

const TEST_SECRET = 'incident-notify-secret';
const DISCORD_URL = 'https://discord.com/api/webhooks/99999/incident-token';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sign(bodyStr, secret) {
  return crypto.createHmac('sha256', secret).update(Buffer.from(bodyStr)).digest('hex');
}

function buildApp() {
  const app = fastify({ logger: false });
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });
  app.post('/webhook/incident', incidentNotifyHandler);
  return app;
}

function mockDiscord(statusCode) {
  const fakeRes = new EventEmitter();
  fakeRes.statusCode = statusCode;
  fakeRes.resume = jest.fn();

  const fakeReq = {
    on: jest.fn().mockReturnThis(),
    write: jest.fn(),
    end: jest.fn(),
  };

  https.request.mockImplementationOnce((_opts, callback) => {
    setImmediate(() => callback(fakeRes));
    return fakeReq;
  });
}

// ---------------------------------------------------------------------------
// Shared env setup
// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.INCIDENT_NOTIFY_SECRET = TEST_SECRET;
});

afterAll(() => {
  delete process.env.INCIDENT_NOTIFY_SECRET;
  delete process.env.INCIDENT_NOTIFY_ENABLED;
  delete process.env.DISCORD_INCIDENT_WEBHOOK_URL;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('incidentNotifyHandler', () => {
  let app;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.INCIDENT_NOTIFY_ENABLED = 'false';
    process.env.DISCORD_INCIDENT_WEBHOOK_URL = DISCORD_URL;
  });

  const validBody = {
    incident_id: 'INC-42',
    severity: 'SEV-1',
    message: 'The database is on fire.',
  };

  async function inject(bodyObj, signatureOverride) {
    const bodyStr = JSON.stringify(bodyObj);
    const sig = signatureOverride !== undefined ? signatureOverride : sign(bodyStr, TEST_SECRET);
    return app.inject({
      method: 'POST',
      url: '/webhook/incident',
      headers: { 'content-type': 'application/json', 'x-incident-signature': sig },
      body: bodyStr,
    });
  }

  test('returns 401 for an invalid signature', async () => {
    const res = await inject(validBody, 'not-a-valid-signature');

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid signature' });
  });

  test('returns 401 when signature header is absent', async () => {
    const bodyStr = JSON.stringify(validBody);
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/incident',
      headers: { 'content-type': 'application/json' },
      body: bodyStr,
    });

    expect(res.statusCode).toBe(401);
  });

  test('returns 400 for malformed JSON body (valid signature)', async () => {
    const rawBody = '{bad json}';
    const sig = sign(rawBody, TEST_SECRET);
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/incident',
      headers: { 'content-type': 'application/json', 'x-incident-signature': sig },
      body: rawBody,
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid JSON' });
  });

  test('returns 400 when incident_id is missing', async () => {
    const { incident_id: _omit, ...incomplete } = validBody;
    const res = await inject(incomplete);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Missing required fields' });
  });

  test('returns 400 when severity is missing', async () => {
    const { severity: _omit, ...incomplete } = validBody;
    const res = await inject(incomplete);

    expect(res.statusCode).toBe(400);
  });

  test('returns 400 when message exceeds 500 characters', async () => {
    const longMessage = 'x'.repeat(501);
    const res = await inject({ ...validBody, message: longMessage });

    expect(res.statusCode).toBe(400);
  });

  test('accepts message of exactly 500 characters', async () => {
    const maxMessage = 'x'.repeat(500);
    const res = await inject({ ...validBody, message: maxMessage });

    // Either 200 (skipped) or 200/502 depending on Discord — not 400.
    expect(res.statusCode).not.toBe(400);
  });

  test('returns 200 skipped=true when INCIDENT_NOTIFY_ENABLED is false', async () => {
    process.env.INCIDENT_NOTIFY_ENABLED = 'false';

    const res = await inject(validBody);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, skipped: true });
    expect(https.request).not.toHaveBeenCalled();
  });

  test('posts to Discord and returns 200 ok=true on success', async () => {
    process.env.INCIDENT_NOTIFY_ENABLED = 'true';
    mockDiscord(204);

    const res = await inject(validBody);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  test('Discord message includes incident_id, severity, and message text', async () => {
    process.env.INCIDENT_NOTIFY_ENABLED = 'true';
    mockDiscord(204);

    await inject(validBody);

    const fakeReq = https.request.mock.results[0].value;
    const written = fakeReq.write.mock.calls[0][0];
    const discordBody = JSON.parse(written);
    expect(discordBody.content).toContain('INC-42');
    expect(discordBody.content).toContain('SEV-1');
    expect(discordBody.content).toContain('The database is on fire.');
  });

  test('returns 502 when Discord webhook responds with non-2xx status', async () => {
    process.env.INCIDENT_NOTIFY_ENABLED = 'true';
    mockDiscord(500);

    const res = await inject(validBody);

    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body)).toEqual({ error: 'Discord notification failed' });
  });

  test('returns 502 when Discord request emits a network error', async () => {
    process.env.INCIDENT_NOTIFY_ENABLED = 'true';

    const fakeReq = {
      on: jest.fn((event, cb) => {
        if (event === 'error') setImmediate(() => cb(new Error('ETIMEDOUT')));
        return fakeReq;
      }),
      write: jest.fn(),
      end: jest.fn(),
    };
    https.request.mockImplementationOnce(() => fakeReq);

    const res = await inject(validBody);

    expect(res.statusCode).toBe(502);
  });
});
