'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');

// Capture the cron callback so tests can invoke it synchronously.
let scheduledCallback;
jest.mock('node-cron', () => ({
  schedule: jest.fn((pattern, cb) => {
    scheduledCallback = cb;
  }),
}));

// Mock http so we can inspect request options/body without a real server.
jest.mock('http', () => ({
  request: jest.fn(),
}));

const cron = require('node-cron');
const http = require('http');

const TEST_SECRET = 'canary-test-secret';

// Load the module after mocks are in place.  The module calls cron.schedule()
// at load time inside startCanary() — but startCanary itself is called by the
// test, so the schedule is registered when we call startCanary(3001).
beforeAll(() => {
  process.env.DISCORD_WEBHOOK_SECRET = TEST_SECRET;
});

afterAll(() => {
  delete process.env.DISCORD_WEBHOOK_SECRET;
});

// Build a fake http request + response pair that tests can control.
function makeFakeRequest(statusCode) {
  const fakeRes = new EventEmitter();
  fakeRes.statusCode = statusCode;
  fakeRes.resume = jest.fn();

  const fakeReq = new EventEmitter();
  fakeReq.write = jest.fn();
  fakeReq.end = jest.fn();

  http.request.mockImplementationOnce((_opts, callback) => {
    // Invoke the response callback asynchronously so req.write/end can finish.
    setImmediate(() => callback(fakeRes));
    return fakeReq;
  });

  return { fakeReq, fakeRes };
}

describe('canary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    scheduledCallback = undefined;
  });

  test('startCanary schedules a cron job with the */5 pattern', () => {
    const { startCanary } = require('../src/canary');
    startCanary(3001);

    expect(cron.schedule).toHaveBeenCalledTimes(1);
    expect(cron.schedule.mock.calls[0][0]).toBe('*/5 * * * *');
  });

  test('cron callback sends HTTP POST to /webhook/discord/approval on the given port', async () => {
    const { startCanary } = require('../src/canary');
    startCanary(3001);

    makeFakeRequest(200);

    // Invoke the callback manually and wait for setImmediate to fire.
    scheduledCallback();
    await new Promise((r) => setImmediate(r));

    expect(http.request).toHaveBeenCalledTimes(1);
    const [options] = http.request.mock.calls[0];
    expect(options.hostname).toBe('127.0.0.1');
    expect(options.port).toBe(3001);
    expect(options.path).toBe('/webhook/discord/approval');
    expect(options.method).toBe('POST');
  });

  test('cron callback includes X-Discord-Signature header with valid HMAC', async () => {
    const { startCanary } = require('../src/canary');
    startCanary(3001);

    makeFakeRequest(200);

    scheduledCallback();
    await new Promise((r) => setImmediate(r));

    const [options] = http.request.mock.calls[0];
    const writtenBody = fakeWrittenBody(http.request.mock.results[0].value);

    // Verify the signature matches the written body.
    const expected = crypto
      .createHmac('sha256', TEST_SECRET)
      .update(writtenBody)
      .digest('hex');

    expect(options.headers['X-Discord-Signature']).toBe(expected);
  });

  test('cron callback sends a synthetic payload with tenant_id __synthetic__', async () => {
    const { startCanary } = require('../src/canary');
    startCanary(3001);

    makeFakeRequest(200);

    scheduledCallback();
    await new Promise((r) => setImmediate(r));

    const writtenBody = fakeWrittenBody(http.request.mock.results[0].value);
    const parsed = JSON.parse(writtenBody);

    expect(parsed.tenant_id).toBe('__synthetic__');
    expect(parsed.status).toBe('pending');
    expect(parsed.user_id).toBe('canary');
    expect(parsed.approval_id).toMatch(/^canary-\d+$/);
  });

  test('cron callback handles non-200 response without throwing', async () => {
    const { startCanary } = require('../src/canary');
    startCanary(3001);

    makeFakeRequest(503);

    // Should resolve without error.
    scheduledCallback();
    await new Promise((r) => setImmediate(r));

    expect(http.request).toHaveBeenCalledTimes(1);
  });

  test('cron callback handles request error without throwing', async () => {
    const { startCanary } = require('../src/canary');
    startCanary(3001);

    const fakeReq = new EventEmitter();
    fakeReq.write = jest.fn();
    fakeReq.end = jest.fn();
    http.request.mockImplementationOnce(() => fakeReq);

    scheduledCallback();

    // Emit an error on the request — should not propagate.
    expect(() => fakeReq.emit('error', new Error('ECONNREFUSED'))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Helper: get the body that was written to a fake request object.
// ---------------------------------------------------------------------------
function fakeWrittenBody(fakeReq) {
  if (!fakeReq || !fakeReq.write) return '';
  const calls = fakeReq.write.mock.calls;
  return calls.map((c) => c[0]).join('');
}
