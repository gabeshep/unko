'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const fastify = require('fastify');

// Mock `https` to prevent real outbound Discord requests.
// We keep the rest of the module real so HMAC/URL parsing still works.
jest.mock('https', () => ({
  request: jest.fn(),
}));

const https = require('https');
const { deployNotifyHandler } = require('../src/deploy-notify');

const TEST_SECRET = 'deploy-notify-secret';
const DISCORD_URL = 'https://discord.com/api/webhooks/12345/fake-token';

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
  app.post('/webhook/deploy', deployNotifyHandler);
  return app;
}

// Simulates a Discord webhook that responds with the given statusCode.
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

beforeAll(async () => {
  process.env.DEPLOY_NOTIFY_SECRET = TEST_SECRET;
});

afterAll(async () => {
  delete process.env.DEPLOY_NOTIFY_SECRET;
  delete process.env.DEPLOYMENT_NOTIFY_ENABLED;
  delete process.env.DISCORD_DEPLOY_WEBHOOK_URL;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deployNotifyHandler', () => {
  let app;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DEPLOYMENT_NOTIFY_ENABLED = 'false';
    process.env.DISCORD_DEPLOY_WEBHOOK_URL = DISCORD_URL;
  });

  const validBody = {
    status: 'success',
    commit_sha: 'abc123',
    commit_message: 'fix: patch the bug',
    deploy_url: 'https://example.com',
    actor: 'alice',
  };

  async function inject(bodyObj, signatureOverride) {
    const bodyStr = JSON.stringify(bodyObj);
    const sig = signatureOverride !== undefined ? signatureOverride : sign(bodyStr, TEST_SECRET);
    return app.inject({
      method: 'POST',
      url: '/webhook/deploy',
      headers: { 'content-type': 'application/json', 'x-deploy-signature': sig },
      body: bodyStr,
    });
  }

  test('returns 401 for an invalid signature', async () => {
    const res = await inject(validBody, 'badsignature');

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid signature' });
  });

  test('returns 401 when signature header is absent', async () => {
    const bodyStr = JSON.stringify(validBody);
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/deploy',
      headers: { 'content-type': 'application/json' },
      body: bodyStr,
    });

    expect(res.statusCode).toBe(401);
  });

  test('returns 400 for malformed JSON body (valid signature)', async () => {
    const rawBody = 'not-json{{{';
    const sig = sign(rawBody, TEST_SECRET);
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/deploy',
      headers: { 'content-type': 'application/json', 'x-deploy-signature': sig },
      body: rawBody,
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid JSON' });
  });

  test('returns 400 when required fields are missing', async () => {
    const { commit_sha: _omit, ...incomplete } = validBody;
    const res = await inject(incomplete);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Missing required fields' });
  });

  test('returns 200 skipped=true when DEPLOYMENT_NOTIFY_ENABLED is false', async () => {
    process.env.DEPLOYMENT_NOTIFY_ENABLED = 'false';

    const res = await inject(validBody);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, skipped: true });
    expect(https.request).not.toHaveBeenCalled();
  });

  test('posts to Discord and returns 200 ok=true on success deploy', async () => {
    process.env.DEPLOYMENT_NOTIFY_ENABLED = 'true';
    mockDiscord(204);

    const res = await inject(validBody);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(https.request).toHaveBeenCalledTimes(1);
  });

  test('Discord success message contains commit SHA and actor', async () => {
    process.env.DEPLOYMENT_NOTIFY_ENABLED = 'true';
    mockDiscord(204);

    await inject(validBody);

    const [opts, _cb] = https.request.mock.calls[0];
    // hostname is from DISCORD_URL
    expect(opts.hostname).toBe('discord.com');

    // Find the write call on the fake request
    const fakeReq = https.request.mock.results[0].value;
    const written = fakeReq.write.mock.calls[0][0];
    const discordBody = JSON.parse(written);
    expect(discordBody.content).toContain('abc123');
    expect(discordBody.content).toContain('alice');
    expect(discordBody.content).toContain('✅');
  });

  test('Discord failure message does not contain URL field', async () => {
    process.env.DEPLOYMENT_NOTIFY_ENABLED = 'true';
    mockDiscord(204);

    await inject({ ...validBody, status: 'failure' });

    const fakeReq = https.request.mock.results[0].value;
    const written = fakeReq.write.mock.calls[0][0];
    const discordBody = JSON.parse(written);
    expect(discordBody.content).toContain('❌');
    expect(discordBody.content).not.toContain(validBody.deploy_url);
  });

  test('truncates commit_message to 100 characters in Discord payload', async () => {
    process.env.DEPLOYMENT_NOTIFY_ENABLED = 'true';
    mockDiscord(204);

    const longMessage = 'x'.repeat(200);
    await inject({ ...validBody, commit_message: longMessage });

    const fakeReq = https.request.mock.results[0].value;
    const written = fakeReq.write.mock.calls[0][0];
    const discordBody = JSON.parse(written);
    expect(discordBody.content).toContain('x'.repeat(100));
    expect(discordBody.content).not.toContain('x'.repeat(101));
  });

  test('returns 502 when Discord webhook returns non-2xx status', async () => {
    process.env.DEPLOYMENT_NOTIFY_ENABLED = 'true';
    mockDiscord(500);

    const res = await inject(validBody);

    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body)).toEqual({ error: 'Discord notification failed' });
  });

  test('returns 502 when Discord request throws a network error', async () => {
    process.env.DEPLOYMENT_NOTIFY_ENABLED = 'true';

    const fakeReq = {
      on: jest.fn((event, cb) => {
        if (event === 'error') setImmediate(() => cb(new Error('ECONNREFUSED')));
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
