'use strict';

// Prevent the cron job from being scheduled when nightly-report.js is required.
jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

// Mock aggregator so we control its output without touching the DB.
jest.mock('../src/aggregator', () => ({
  aggregatePeriod: jest.fn(),
  checkAnomalies: jest.fn(),
}));

// Mock db for the 7-day trailing query.
jest.mock('../src/db', () => ({
  query: jest.fn(),
}));

// Spy on fs methods to avoid real disk writes.
const fs = require('fs');
jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
jest.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

const { aggregatePeriod, checkAnomalies } = require('../src/aggregator');
const db = require('../src/db');
const { generateReport } = require('../src/nightly-report');

const PERIOD_START = new Date('2026-04-10T00:00:00Z');
const PERIOD_END   = new Date('2026-04-11T00:00:00Z');

// ---------------------------------------------------------------------------
// Shared summary fixture
// ---------------------------------------------------------------------------

function makeSummary(overrides = {}) {
  return {
    ticketId: 'PROJ-1',
    outcome: 'success',
    totalTokens: 3000,
    tokenCostUsd: 0.009,
    totalComputeMin: 10,
    computeCostUsd: 0.08,
    totalCostUsd: 0.089,
    isBreakglass: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateReport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('calls aggregatePeriod with the provided period bounds', async () => {
    aggregatePeriod.mockResolvedValueOnce([]);
    checkAnomalies.mockResolvedValueOnce([]);
    db.query.mockResolvedValueOnce({ rows: [] });

    await generateReport(PERIOD_START, PERIOD_END);

    expect(aggregatePeriod).toHaveBeenCalledWith(PERIOD_START, PERIOD_END);
  });

  test('calls checkAnomalies with the summaries returned by aggregatePeriod', async () => {
    const summaries = [makeSummary()];
    aggregatePeriod.mockResolvedValueOnce(summaries);
    checkAnomalies.mockResolvedValueOnce([]);
    db.query.mockResolvedValueOnce({ rows: [] });

    await generateReport(PERIOD_START, PERIOD_END);

    expect(checkAnomalies).toHaveBeenCalledWith(summaries);
  });

  test('creates the reports directory with mkdirSync', async () => {
    aggregatePeriod.mockResolvedValueOnce([]);
    checkAnomalies.mockResolvedValueOnce([]);
    db.query.mockResolvedValueOnce({ rows: [] });

    await generateReport(PERIOD_START, PERIOD_END);

    expect(fs.mkdirSync).toHaveBeenCalledTimes(1);
    const [dir, opts] = fs.mkdirSync.mock.calls[0];
    expect(typeof dir).toBe('string');
    expect(opts).toEqual({ recursive: true });
  });

  test('writes a CSV file with the date label derived from periodEnd', async () => {
    aggregatePeriod.mockResolvedValueOnce([]);
    checkAnomalies.mockResolvedValueOnce([]);
    db.query.mockResolvedValueOnce({ rows: [] });

    await generateReport(PERIOD_START, PERIOD_END);

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [filePath] = fs.writeFileSync.mock.calls[0];
    // periodEnd is 2026-04-11 — file name should include that date
    expect(filePath).toContain('unit-economics-2026-04-11');
    expect(filePath).toMatch(/\.csv$/);
  });

  test('CSV contains section headers for 7-day summary and per-ticket detail', async () => {
    aggregatePeriod.mockResolvedValueOnce([]);
    checkAnomalies.mockResolvedValueOnce([]);
    db.query.mockResolvedValueOnce({ rows: [] });

    await generateReport(PERIOD_START, PERIOD_END);

    const [, csvContent] = fs.writeFileSync.mock.calls[0];
    expect(csvContent).toContain('7-day trailing cost summary');
    expect(csvContent).toContain('Per-ticket detail for this period');
    expect(csvContent).toContain('ticket_id,outcome,total_tokens');
  });

  test('CSV per-ticket section includes a row for each summary', async () => {
    const summaries = [
      makeSummary({ ticketId: 'PROJ-A', outcome: 'success' }),
      makeSummary({ ticketId: 'PROJ-B', outcome: 'failure' }),
    ];
    aggregatePeriod.mockResolvedValueOnce(summaries);
    checkAnomalies.mockResolvedValueOnce([]);
    db.query.mockResolvedValueOnce({ rows: [] });

    await generateReport(PERIOD_START, PERIOD_END);

    const [, csvContent] = fs.writeFileSync.mock.calls[0];
    expect(csvContent).toContain('PROJ-A');
    expect(csvContent).toContain('PROJ-B');
  });

  test('CSV 7-day section includes rows from the trailing DB query', async () => {
    aggregatePeriod.mockResolvedValueOnce([]);
    checkAnomalies.mockResolvedValueOnce([]);
    db.query.mockResolvedValueOnce({
      rows: [
        {
          outcome: 'success',
          ticket_count: 10,
          avg_cost_usd: '0.050000',
          total_cost_usd: '0.500000',
          avg_token_cost_usd: '0.030000',
          avg_compute_cost_usd: '0.020000',
        },
      ],
    });

    await generateReport(PERIOD_START, PERIOD_END);

    const [, csvContent] = fs.writeFileSync.mock.calls[0];
    expect(csvContent).toContain('success');
    expect(csvContent).toContain('10');
  });

  test('returns csvPath, summaries, and anomalies', async () => {
    const summaries = [makeSummary()];
    const anomalies = [{ ticketId: 'PROJ-1', totalCostUsd: 9.99, baseline: 1.0, threshold: 1.5, outcome: 'success' }];
    aggregatePeriod.mockResolvedValueOnce(summaries);
    checkAnomalies.mockResolvedValueOnce(anomalies);
    db.query.mockResolvedValueOnce({ rows: [] });

    const result = await generateReport(PERIOD_START, PERIOD_END);

    expect(result.summaries).toBe(summaries);
    expect(result.anomalies).toBe(anomalies);
    expect(result.csvPath).toContain('.csv');
  });

  test('logs anomalies to stderr as structured JSON', async () => {
    const anomaly = {
      ticketId: 'PROJ-X',
      totalCostUsd: 5.0,
      baseline: 1.0,
      threshold: 1.5,
      outcome: 'failure',
    };
    aggregatePeriod.mockResolvedValueOnce([makeSummary({ ticketId: 'PROJ-X' })]);
    checkAnomalies.mockResolvedValueOnce([anomaly]);
    db.query.mockResolvedValueOnce({ rows: [] });

    const stderrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await generateReport(PERIOD_START, PERIOD_END);

    // Should have logged the anomaly as JSON to stderr
    const anomalyLogs = stderrSpy.mock.calls
      .map((c) => { try { return JSON.parse(c[0]); } catch { return null; } })
      .filter(Boolean);
    const anomalyLog = anomalyLogs.find((l) => l.event === 'unit_economics_anomaly');
    expect(anomalyLog).toBeDefined();
    expect(anomalyLog.ticket_id).toBe('PROJ-X');

    stderrSpy.mockRestore();
  });

  test('queries db with a date 7 days before now for the trailing summary', async () => {
    aggregatePeriod.mockResolvedValueOnce([]);
    checkAnomalies.mockResolvedValueOnce([]);
    db.query.mockResolvedValueOnce({ rows: [] });

    const before = Date.now();
    await generateReport(PERIOD_START, PERIOD_END);
    const after = Date.now();

    expect(db.query).toHaveBeenCalledTimes(1);
    const [, params] = db.query.mock.calls[0];
    const sevenDaysAgoParam = params[0];
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    expect(sevenDaysAgoParam.getTime()).toBeGreaterThanOrEqual(before - sevenDaysMs - 100);
    expect(sevenDaysAgoParam.getTime()).toBeLessThanOrEqual(after - sevenDaysMs + 100);
  });
});
