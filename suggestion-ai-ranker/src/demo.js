'use strict';

/**
 * Standalone demo — shows ranking in action without starting the HTTP server.
 * Run with: ANTHROPIC_API_KEY=... node src/demo.js
 */

const { rankPlaces, applyRanking } = require('./ranker');

// Sample places in Foursquare API shape (truncated for demo)
const SAMPLE_PLACES = [
  { fsq_id: 'aaa111', name: 'The Grand Bistro', categories: [{ name: 'French Restaurant' }], distance: 300, location: { formatted_address: '12 Rue de la Paix' } },
  { fsq_id: 'bbb222', name: 'City Park Botanical Garden', categories: [{ name: 'Botanical Garden' }], distance: 800, location: { formatted_address: '5 Park Avenue' } },
  { fsq_id: 'ccc333', name: 'Night Owl Jazz Club', categories: [{ name: 'Jazz Club' }], distance: 450, location: { formatted_address: '88 Blues Street' } },
  { fsq_id: 'ddd444', name: 'Morning Dew Café', categories: [{ name: 'Coffee Shop' }], distance: 120, location: { formatted_address: '3 Market Square' } },
  { fsq_id: 'eee555', name: 'Museum of Modern Art', categories: [{ name: 'Art Museum' }], distance: 600, location: { formatted_address: '1 Culture Blvd' } },
];

async function runDemo() {
  const context = {
    category: 'eat',
    timeOfDay: 'morning',
    weather: 'sunny',
    vibe: 'something light and quick — I have a tour in an hour',
  };

  console.log('=== Suggestion AI Ranker — Demo ===\n');
  console.log('Context:', JSON.stringify(context, null, 2));
  console.log('\nPlaces (unranked):');
  SAMPLE_PLACES.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} (${p.categories[0].name}, ${p.distance}m)`));

  console.log('\nCalling Claude to rank...\n');

  try {
    const { rankedIds, reasoning } = await rankPlaces(SAMPLE_PLACES, context);
    const ranked = applyRanking(SAMPLE_PLACES, rankedIds);

    console.log('Ranked places:');
    ranked.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} (${p.categories[0].name}, ${p.distance}m)`));
    console.log('\nClaude\'s reasoning:', reasoning);
  } catch (err) {
    console.error('Demo failed:', err.message);
    process.exit(1);
  }
}

runDemo();
