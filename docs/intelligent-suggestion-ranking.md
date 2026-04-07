# Research: Intelligent Suggestion Ranking with Claude

**Ticket:** 45e772f0-960c-4701-b272-c15ae61981e5  
**Status:** Prototype complete — ready for integration decision

---

## Problem

The current suggestion pool is shuffled randomly. Foursquare returns up to 50 places; the app picks from them without considering:

- Time of day (a jazz club at 9 AM is a bad pick)
- Weather (an outdoor market in a downpour isn't ideal)
- User-stated mood or preference ("something quick", "something chill")
- Category affinity within a session (a user who tapped "Nah" on every bar likely doesn't want bars)

The result is an unpredictable experience. A first suggestion that misses badly increases abandonment.

---

## Approach

Use Claude as a lightweight ranking layer between the Foursquare response and the UI.

**Flow:**

```
Foursquare (50 places)
        ↓
suggestion-ai-ranker  ←── user context (time, weather, vibe)
        ↓ Claude API
Re-ordered place array + reasoning string
        ↓
Frontend (shows top suggestion first)
```

Claude receives a compact JSON summary of places and returns a ranked ID list plus a brief explanation. The frontend shows the first suggestion immediately; the explanation can optionally be surfaced as a tooltip or "Why this?" feature.

---

## Prototype

Located at `suggestion-ai-ranker/`. It exposes a single `POST /rank` endpoint accepted by the existing Fastify pattern used across the project.

### Request shape

```json
{
  "places": [ /* Foursquare place objects */ ],
  "context": {
    "category": "eat",
    "timeOfDay": "morning",
    "weather": "sunny",
    "vibe": "something light and quick"
  }
}
```

### Response shape

```json
{
  "places": [ /* same objects, re-ordered */ ],
  "reasoning": "Morning Coffee and Morning Dew Café ranked first given the early hour and quick-bite preference."
}
```

Graceful degradation: if the Claude call fails (network timeout, API error), the service returns the original Foursquare order with `error` set. The UI never blocks.

---

## Claude model selection

| Model | Latency | Cost per ranking call | Notes |
|---|---|---|---|
| `claude-opus-4-6` (adaptive thinking) | ~2–4s | ~$0.003 | Best quality; worth it for first suggestion |
| `claude-haiku-4-5` | ~0.5s | ~$0.0003 | Acceptable for bulk pre-ranking |

**Recommendation:** Use Haiku for background pre-ranking of the full pool on page load, then Opus for re-ranking when the user explicitly states a vibe. This keeps the hot path under 1 second.

---

## Token budget analysis

A batch of 50 places (compact summary, no geocodes) is ~600 tokens of input. Claude's reasoning response is ~150 tokens. At Haiku pricing ($1/1M input, $5/1M output):

- ~$0.0006 per ranking call
- 1,000 daily active users → ~$0.60/day

This is negligible. Even at Opus pricing ($5/$25/1M), it's ~$6/day at 1k DAU — well within acceptable range before any caching is applied.

Prompt caching can be applied to the static system instructions to cut input costs ~90% on repeat calls.

---

## Integration path

1. **Phase 1 (current prototype):** Deploy `suggestion-ai-ranker` as a sidecar to `places-api-service` on Render. Places API fetches from Foursquare → ranking service reorders → frontend gets ranked results.

2. **Phase 2:** Move ranking into `places-api-service` directly (collapse services). Add a `ranked=true` query param so ranking is opt-in while the feature stabilizes.

3. **Phase 3:** Collect implicit feedback (which suggestion the user picked vs. "Nah"d) and use it to fine-tune the vibe prompt or add few-shot examples.

---

## Open questions

- Should the `vibe` field be free-text (captured via a new UI input) or inferred from session behavior?
- Do we surface Claude's `reasoning` to the user? A "Why this?" CTA could increase trust.
- Rate limiting: one ranking call per search, or debounce on "Nah" presses?

---

## Files

```
suggestion-ai-ranker/
├── package.json
└── src/
    ├── index.js    — Fastify HTTP service (POST /rank)
    ├── ranker.js   — Core Claude ranking logic
    └── demo.js     — Standalone demo script
```
