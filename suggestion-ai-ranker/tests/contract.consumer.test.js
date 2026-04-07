'use strict';

/**
 * Contract Consumer Test: suggestion-ai-ranker → places-api-service
 *
 * Defines what the suggestion-ai-ranker needs from places-api-service.
 * The ranker's summarizePlaces() function maps each place to the fields
 * used in the Claude prompt: fsq_id (as id), name, categories[0].name,
 * distance, and location.formatted_address / location.address.
 *
 * If places-api-service ever drops or renames one of these fields, this test
 * catches the breakage before it reaches production.
 */

const contract = require('../../contracts/ranker-consumer--places-api-service.json');

// ---------------------------------------------------------------------------
// Inline implementation of summarizePlaces for consumer-side verification.
// Mirrors the logic in src/ranker.js so the test remains self-contained and
// does not require the Anthropic SDK at test time.
// ---------------------------------------------------------------------------

function summarizePlaces(places) {
  return places.map((p) => ({
    id:       p.fsq_id,
    name:     p.name,
    type:     p.categories?.[0]?.name ?? 'Unknown',
    distance: p.distance ?? null,
    address:  p.location?.formatted_address ?? p.location?.address ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Consumer contract tests
// ---------------------------------------------------------------------------

describe(`Contract consumer test: ${contract.consumer} consuming ${contract.provider}`, () => {
  describe('contracted place shape satisfies summarizePlaces() field requirements', () => {
    const eatInteraction = contract.interactions.find(
      (i) => i.description === 'fetches eat places by location'
    );
    const examplePlace = eatInteraction.example_response.results[0];

    test('fsq_id is a non-empty string (used as the ranking ID)', () => {
      expect(typeof examplePlace.fsq_id).toBe('string');
      expect(examplePlace.fsq_id.length).toBeGreaterThan(0);
    });

    test('name is a non-empty string (shown to Claude for ranking)', () => {
      expect(typeof examplePlace.name).toBe('string');
      expect(examplePlace.name.length).toBeGreaterThan(0);
    });

    test('categories array provides a readable type label', () => {
      expect(Array.isArray(examplePlace.categories)).toBe(true);
      // Categories may be empty (summarizePlaces falls back to "Unknown"), but
      // when present the first element must have a .name string.
      if (examplePlace.categories.length > 0) {
        expect(typeof examplePlace.categories[0].name).toBe('string');
      }
    });

    test('location provides at least one address field', () => {
      expect(examplePlace.location).toBeDefined();
      const hasAddress =
        typeof examplePlace.location.formatted_address === 'string' ||
        typeof examplePlace.location.address === 'string';
      expect(hasAddress).toBe(true);
    });

    test('summarizePlaces() produces a valid summary from the contracted example place', () => {
      const [summary] = summarizePlaces([examplePlace]);

      expect(summary.id).toBe(examplePlace.fsq_id);
      expect(summary.name).toBe(examplePlace.name);
      expect(typeof summary.type).toBe('string');
      expect(summary.type).not.toBe('');
    });

    test('summarizePlaces() degrades gracefully when optional fields are absent', () => {
      // The contract marks categories and location as optional at the item level.
      // summarizePlaces must still return a usable object.
      const minimalPlace = { fsq_id: 'min-01', name: 'Minimal Spot' };
      const [summary] = summarizePlaces([minimalPlace]);

      expect(summary.id).toBe('min-01');
      expect(summary.name).toBe('Minimal Spot');
      expect(summary.type).toBe('Unknown');
      expect(summary.distance).toBeNull();
      expect(summary.address).toBeNull();
    });
  });

  describe('contracted response structure for /places/search', () => {
    test('response body has a "results" array at the top level', () => {
      const eatInteraction = contract.interactions.find(
        (i) => i.description === 'fetches eat places by location'
      );
      expect(eatInteraction.response.body).toHaveProperty('results');
      expect(eatInteraction.response.body.results.type).toBe('array');
    });

    test('required_properties include fsq_id and name for every place', () => {
      const eatInteraction = contract.interactions.find(
        (i) => i.description === 'fetches eat places by location'
      );
      const { required_properties } = eatInteraction.response.body.results.items;
      expect(required_properties).toContain('fsq_id');
      expect(required_properties).toContain('name');
    });
  });

  describe('contracted error behavior', () => {
    test('invalid category returns 400 — ranker must handle upstream rejection', () => {
      const invalidInteraction = contract.interactions.find(
        (i) => i.description === 'returns 400 for invalid category'
      );
      // Consumer acknowledges that invalid cat values yield a 400, not a 200/503.
      // This ensures the ranker treats 400 as a client error (bad request), not
      // a transient server failure worth retrying.
      expect(invalidInteraction.response.status).toBe(400);
    });
  });

  describe('contracted health check', () => {
    test('health endpoint must return status=ok for ranker readiness probe', () => {
      const healthInteraction = contract.interactions.find(
        (i) => i.description === 'health check returns ok'
      );
      expect(healthInteraction.response.body.status.value).toBe('ok');
    });
  });
});
