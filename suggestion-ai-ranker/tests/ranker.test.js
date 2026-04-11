'use strict';

// Mock the Anthropic SDK before requiring ranker.js, which instantiates a
// client at module load time via `const client = new Anthropic()`.
jest.mock('@anthropic-ai/sdk');

const Anthropic = require('@anthropic-ai/sdk');

// Provide a mock `messages.create` that individual tests can configure.
const mockCreate = jest.fn();
Anthropic.mockImplementation(() => ({
  messages: { create: mockCreate },
}));

const { rankPlaces, applyRanking } = require('../src/ranker');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlace(overrides = {}) {
  return {
    fsq_id: 'fsq-001',
    name: 'Test Café',
    categories: [{ name: 'Coffee Shop' }],
    distance: 120,
    location: { formatted_address: '1 Main St, Springfield' },
    ...overrides,
  };
}

function claudeResponse(ranked_ids, reasoning = 'Test reasoning') {
  return {
    content: [
      { type: 'text', text: JSON.stringify({ ranked_ids, reasoning }) },
    ],
  };
}

// ---------------------------------------------------------------------------
// rankPlaces
// ---------------------------------------------------------------------------

describe('rankPlaces', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns empty rankedIds without calling Claude when places array is empty', async () => {
    const result = await rankPlaces([], { category: 'eat' });

    expect(result).toEqual({ rankedIds: [], reasoning: 'No places to rank.' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('returns empty rankedIds without calling Claude when places is null', async () => {
    const result = await rankPlaces(null, { category: 'eat' });

    expect(result).toEqual({ rankedIds: [], reasoning: 'No places to rank.' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('calls Claude with the correct model and returns ranked IDs', async () => {
    const places = [makePlace({ fsq_id: 'a1' }), makePlace({ fsq_id: 'b2', name: 'Burger Joint' })];
    mockCreate.mockResolvedValueOnce(claudeResponse(['a1', 'b2']));

    const result = await rankPlaces(places, { category: 'eat' });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('claude-opus-4-6');
    expect(callArgs.thinking).toEqual({ type: 'adaptive' });
    expect(result.rankedIds).toEqual(['a1', 'b2']);
    expect(result.reasoning).toBe('Test reasoning');
  });

  test('includes optional context lines in the prompt when provided', async () => {
    const places = [makePlace()];
    mockCreate.mockResolvedValueOnce(claudeResponse(['fsq-001']));

    await rankPlaces(places, {
      category: 'eat',
      timeOfDay: 'morning',
      weather: 'sunny',
      vibe: 'something chill',
    });

    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('Time of day: morning');
    expect(prompt).toContain('Weather: sunny');
    expect(prompt).toContain('User vibe / preference: "something chill"');
  });

  test('omits null optional context lines from the prompt', async () => {
    const places = [makePlace()];
    mockCreate.mockResolvedValueOnce(claudeResponse(['fsq-001']));

    await rankPlaces(places, { category: 'see' });

    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).not.toContain('Time of day');
    expect(prompt).not.toContain('Weather');
    expect(prompt).not.toContain('User vibe');
    expect(prompt).toContain('Category intent: see');
  });

  test('extracts JSON even when surrounded by extra text in Claude response', async () => {
    const places = [makePlace({ fsq_id: 'x9' })];
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: 'Sure! Here is the ranking:\n{"ranked_ids":["x9"],"reasoning":"Only option."}\nDone.',
        },
      ],
    });

    const result = await rankPlaces(places, { category: 'do' });

    expect(result.rankedIds).toEqual(['x9']);
    expect(result.reasoning).toBe('Only option.');
  });

  test('throws when Claude returns no text block', async () => {
    const places = [makePlace()];
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'thinking', thinking: 'hmm' }] });

    await expect(rankPlaces(places, { category: 'eat' })).rejects.toThrow(
      'Claude returned no text block'
    );
  });

  test('throws when Claude text block contains no JSON', async () => {
    const places = [makePlace()];
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'I cannot help with that.' }],
    });

    await expect(rankPlaces(places, { category: 'eat' })).rejects.toThrow(
      'Could not find JSON in Claude response'
    );
  });

  test('defaults to empty rankedIds when ranked_ids key is absent from Claude JSON', async () => {
    const places = [makePlace()];
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"reasoning":"all good"}' }],
    });

    const result = await rankPlaces(places, { category: 'eat' });

    expect(result.rankedIds).toEqual([]);
    expect(result.reasoning).toBe('all good');
  });

  test('propagates Claude API errors', async () => {
    const places = [makePlace()];
    mockCreate.mockRejectedValueOnce(new Error('rate limit exceeded'));

    await expect(rankPlaces(places, { category: 'eat' })).rejects.toThrow('rate limit exceeded');
  });
});

// ---------------------------------------------------------------------------
// applyRanking
// ---------------------------------------------------------------------------

describe('applyRanking', () => {
  const places = [
    makePlace({ fsq_id: 'a', name: 'Alpha' }),
    makePlace({ fsq_id: 'b', name: 'Beta' }),
    makePlace({ fsq_id: 'c', name: 'Gamma' }),
  ];

  test('reorders places to match ranked IDs', () => {
    const result = applyRanking(places, ['c', 'a', 'b']);

    expect(result.map((p) => p.fsq_id)).toEqual(['c', 'a', 'b']);
  });

  test('appends unranked places after ranked ones in original order', () => {
    const result = applyRanking(places, ['b']);

    expect(result.map((p) => p.fsq_id)).toEqual(['b', 'a', 'c']);
  });

  test('returns original order when rankedIds is empty', () => {
    const result = applyRanking(places, []);

    expect(result.map((p) => p.fsq_id)).toEqual(['a', 'b', 'c']);
  });

  test('ignores ranked IDs that do not match any place', () => {
    const result = applyRanking(places, ['z99', 'a', 'b', 'c']);

    expect(result.map((p) => p.fsq_id)).toEqual(['a', 'b', 'c']);
  });

  test('returns empty array when places is empty', () => {
    const result = applyRanking([], ['a', 'b']);

    expect(result).toEqual([]);
  });
});
