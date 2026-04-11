'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

const client = new Anthropic(config.anthropicApiKey ? { apiKey: config.anthropicApiKey } : {});

/**
 * Build a compact, token-efficient summary of places for Claude to rank.
 * We strip geocodes and internal IDs to reduce input tokens.
 */
function summarizePlaces(places) {
  return places.map((p) => ({
    id: p.fsq_id,
    name: p.name,
    type: p.categories?.[0]?.name ?? 'Unknown',
    distance: p.distance ?? null,
    address: p.location?.formatted_address ?? p.location?.address ?? null,
  }));
}

/**
 * Rank a list of Foursquare places using Claude.
 *
 * @param {Object[]} places   - Raw Foursquare place objects
 * @param {Object}  context  - User context for ranking decisions
 * @param {string}  context.category  - 'eat' | 'see' | 'do'
 * @param {string}  [context.timeOfDay]  - 'morning' | 'afternoon' | 'evening' | 'night'
 * @param {string}  [context.weather]    - e.g. 'sunny', 'rainy', 'cold'
 * @param {string}  [context.vibe]       - free-text user preference, e.g. 'something chill'
 * @returns {Promise<Object>} - { rankedIds: string[], reasoning: string }
 */
async function rankPlaces(places, context) {
  if (!places || places.length === 0) {
    return { rankedIds: [], reasoning: 'No places to rank.' };
  }

  const summaries = summarizePlaces(places);
  const contextLines = [
    `Category intent: ${context.category}`,
    context.timeOfDay ? `Time of day: ${context.timeOfDay}` : null,
    context.weather ? `Weather: ${context.weather}` : null,
    context.vibe ? `User vibe / preference: "${context.vibe}"` : null,
  ].filter(Boolean).join('\n');

  const prompt = `You are a local guide helping a traveler pick the best place to visit next.

User context:
${contextLines}

Here are up to ${summaries.length} nearby places. Rank them from most to least suitable given the context. Return ONLY valid JSON in this shape:
{
  "ranked_ids": ["<fsq_id>", ...],
  "reasoning": "<1-2 sentence explanation>"
}

Places:
${JSON.stringify(summaries, null, 2)}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: prompt }],
  });

  // Extract the text block (thinking blocks come first with adaptive thinking)
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('Claude returned no text block');
  }

  // Parse the JSON payload Claude returns
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Could not find JSON in Claude response: ${textBlock.text}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    rankedIds: parsed.ranked_ids ?? [],
    reasoning: parsed.reasoning ?? '',
  };
}

/**
 * Re-order the original place array to match Claude's ranking.
 * Places not mentioned in rankedIds are appended at the end (preserving original order).
 */
function applyRanking(places, rankedIds) {
  const idToPlace = new Map(places.map((p) => [p.fsq_id, p]));
  const ranked = rankedIds.map((id) => idToPlace.get(id)).filter(Boolean);
  const unranked = places.filter((p) => !rankedIds.includes(p.fsq_id));
  return [...ranked, ...unranked];
}

module.exports = { rankPlaces, applyRanking };
