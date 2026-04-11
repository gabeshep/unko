'use strict';

jest.mock('../src/db', () => ({
  query: jest.fn(),
}));

const db = require('../src/db');

// ---- telemetry-emitter ----

describe('telemetry-emitter', () => {
  beforeEach(() => jest.clearAllMocks());

  const { emitStep } = require('../src/telemetry-emitter');

  test('inserts a row with correct fields', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await emitStep({
      ticketId: 'PROJ-1',
      actionType: 'code',
      modelName: 'claude-sonnet-4-6',
      tokensUsed: 1500,
      tags: [],
    });

    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO ai_step_telemetry/);
    expect(params).toEqual(['PROJ-1', 'code', 'claude-sonnet-4-6', 1500, []]);
  });

  test('attaches SEV-1-BREAKGLASS tag when provided', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await emitStep({
      ticketId: 'PROJ-99',
      actionType: 'ci_verify',
      modelName: 'claude-sonnet-4-6',
      tokensUsed: 200,
      tags: ['SEV-1-BREAKGLASS'],
    });

    const [, params] = db.query.mock.calls[0];
    expect(params[4]).toEqual(['SEV-1-BREAKGLASS']);
  });

  test('throws when required fields are missing', async () => {
    await expect(emitStep({ ticketId: 'PROJ-1' })).rejects.toThrow('missing required fields');
    expect(db.query).not.toHaveBeenCalled();
  });
});

// ---- ci-telemetry ----

describe('ci-telemetry', () => {
  beforeEach(() => jest.clearAllMocks());

  const { emitJob } = require('../src/ci-telemetry');

  test('inserts a row with correct fields', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await emitJob({
      ticketId: 'PROJ-2',
      workflowRunId: 'run-123',
      jobName: 'e2e-smoke-tests',
      runnerSize: 'ubuntu-latest',
      computeMinutes: 4.5,
      outcome: 'success',
      tags: [],
    });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO ci_job_telemetry/);
    expect(params).toEqual(['PROJ-2', 'run-123', 'e2e-smoke-tests', 'ubuntu-latest', 4.5, 'success', []]);
  });

  test('defaults runnerSize to ubuntu-latest', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await emitJob({
      ticketId: 'PROJ-3',
      workflowRunId: 'run-456',
      jobName: 'validate',
      computeMinutes: 1.2,
      outcome: 'success',
    });

    const [, params] = db.query.mock.calls[0];
    expect(params[3]).toBe('ubuntu-latest');
  });

  test('throws when required fields are missing', async () => {
    await expect(emitJob({ ticketId: 'PROJ-4' })).rejects.toThrow('missing required fields');
    expect(db.query).not.toHaveBeenCalled();
  });
});

// ---- aggregator ----

describe('aggregator.aggregatePeriod', () => {
  beforeEach(() => jest.clearAllMocks());

  const { aggregatePeriod } = require('../src/aggregator');

  test('returns empty array when no tickets in period', async () => {
    // distinct ticket query returns nothing
    db.query.mockResolvedValueOnce({ rows: [] });

    const result = await aggregatePeriod(new Date('2026-04-01'), new Date('2026-04-02'));
    expect(result).toEqual([]);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('calculates token and compute costs correctly', async () => {
    // 1. Distinct ticket IDs
    db.query.mockResolvedValueOnce({ rows: [{ ticket_id: 'PROJ-10' }] });
    // 2. Breakglass check
    db.query.mockResolvedValueOnce({ rows: [{ is_breakglass: false }] });
    // 3. Token totals
    db.query.mockResolvedValueOnce({ rows: [{ total_tokens: 3000 }] });
    // 4. Compute totals
    db.query.mockResolvedValueOnce({ rows: [{ total_compute_min: '10.00', outcome: 'success' }] });
    // 5. UPSERT
    db.query.mockResolvedValueOnce({ rows: [] });

    const result = await aggregatePeriod(new Date('2026-04-01'), new Date('2026-04-02'));

    expect(result).toHaveLength(1);
    const s = result[0];
    expect(s.ticketId).toBe('PROJ-10');
    // 3000 tokens * $0.003 / 1000 = $0.009
    expect(s.tokenCostUsd).toBeCloseTo(0.009, 6);
    // 10 min * $0.008 = $0.08
    expect(s.computeCostUsd).toBeCloseTo(0.08, 6);
    expect(s.totalCostUsd).toBeCloseTo(0.089, 6);
    expect(s.outcome).toBe('success');
    expect(s.isBreakglass).toBe(false);
  });

  test('marks breakglass tickets as excluded_from_baseline', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ticket_id: 'SEV-42' }] });
    db.query.mockResolvedValueOnce({ rows: [{ is_breakglass: true }] });
    db.query.mockResolvedValueOnce({ rows: [{ total_tokens: 500 }] });
    db.query.mockResolvedValueOnce({ rows: [{ total_compute_min: '2.00', outcome: 'success' }] });
    db.query.mockResolvedValueOnce({ rows: [] });

    const result = await aggregatePeriod(new Date('2026-04-01'), new Date('2026-04-02'));
    expect(result[0].isBreakglass).toBe(true);

    // Check the upsert includes excluded_from_baseline = true
    const upsertCall = db.query.mock.calls[4];
    expect(upsertCall[1][9]).toBe(true);
  });
});

describe('aggregator.checkAnomalies', () => {
  beforeEach(() => jest.clearAllMocks());

  const { checkAnomalies } = require('../src/aggregator');

  test('returns empty when baseline is zero (not enough history)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ avg_cost: null }] });

    const anomalies = await checkAnomalies([{ ticketId: 'X', totalCostUsd: 999, isBreakglass: false }]);
    expect(anomalies).toEqual([]);
  });

  test('flags tickets exceeding baseline by >50%', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ avg_cost: '1.00' }] });

    const summaries = [
      { ticketId: 'OK-1',  totalCostUsd: 1.4, isBreakglass: false, outcome: 'success' },
      { ticketId: 'BAD-1', totalCostUsd: 1.6, isBreakglass: false, outcome: 'failure' },
    ];

    const anomalies = await checkAnomalies(summaries);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].ticketId).toBe('BAD-1');
  });

  test('skips breakglass tickets in anomaly detection', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ avg_cost: '0.10' }] });

    const summaries = [
      { ticketId: 'BG-1', totalCostUsd: 99.99, isBreakglass: true, outcome: 'success' },
    ];

    const anomalies = await checkAnomalies(summaries);
    expect(anomalies).toHaveLength(0);
  });
});
