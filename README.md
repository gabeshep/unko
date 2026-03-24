# Wander

> Find your next adventure — wherever you are.

A vacation discovery app that surfaces things to do, places to eat, and sights to see based on your current location. One suggestion at a time. No account needed. No noise.

---

## How it works

1. The app requests browser geolocation on load
2. The user optionally selects a category: **Do**, **Eat**, or **See** (no selection = all three rotate)
3. The user taps **Find Something**
4. A single nearby suggestion is shown: name, type, and distance
5. **Let's go →** opens Google Maps with turn-by-turn directions
6. **Nah, what else →** loads the next suggestion
7. Category buttons remain visible at all times — tapping one filters to that category immediately
8. When suggestions run out, the app refetches fresh results

---

## Current tech stack

- **Frontend:** Single-page HTML/CSS/JS — no build step, no framework, no dependencies
- **Location data:** Browser Geolocation API (`navigator.geolocation`)
- **Places data:** [Overpass API](https://overpass-api.de/) (OpenStreetMap) — free, no API key required
- **Reverse geocoding:** [Nominatim](https://nominatim.openstreetmap.org/) — free, no API key required
- **Directions:** Google Maps URL scheme (`maps.google.com/maps/dir/?api=1&destination=...`) — no API key required

**Why no API keys?** The MVP was built to be zero-config and immediately deployable. The Overpass API works well but has rate limits and returns raw OSM data without ratings, photos, or hours. That's the primary limitation to address.

---

## What works today (MVP)

- [x] Geolocation with city name display
- [x] Do / Eat / See category filtering
- [x] Overpass API queries for nearby places (restaurants, museums, parks, etc.)
- [x] Card-based suggestion UI with type badge, distance, and address
- [x] "Let's go" → Google Maps directions
- [x] "Nah, what else" → next suggestion with card transition animation
- [x] Category switching mid-session (re-fetches filtered results)
- [x] Loading, error, and empty states
- [x] Pool exhaustion handling (auto-refetches)
- [x] Responsive, mobile-first layout

---

## What needs building

The following are the priority areas for improvement, roughly in order:

### 1. Places data quality
The biggest gap. Overpass returns raw OSM data — no ratings, no photos, no opening hours, no reviews.

**Options to evaluate:**
- **Google Places API** — richest data (ratings, photos, hours, reviews), requires API key, paid beyond free tier
- **Foursquare Places API** — solid ratings + categories, generous free tier
- **Yelp Fusion API** — strong for restaurants, US-focused
- **TripAdvisor Content API** — good for tourism/sights

Recommendation: Add a `places-provider` abstraction layer so the data source can be swapped per category or per environment without rewriting the UI.

### 2. Suggestion quality
Currently suggestions are shuffled randomly. They should be ranked by:
- User ratings
- Relevance to the active category
- Distance (closer isn't always better — some context-sensitivity needed)
- Whether the place is currently open

### 3. Filtering options
Users on vacation have different needs than locals. Useful filters:
- Open now
- Walking distance only (toggle)
- Price range (for Eat)
- Subcategory refinement (e.g., "bars only", "museums only")

### 4. Seen / skipped memory
Once a user clicks "Nah, what else" on a suggestion, it should not appear again in the same session. Currently the pool is refetched fresh when exhausted, which can show repeats.

Simple fix: maintain a `seenIds` Set in state and filter against it on refetch.

### 5. Progressive Web App (PWA)
The app is designed for vacation use on mobile. It should:
- Work offline (cached suggestions for current area)
- Be installable to home screen (manifest + service worker)
- Not require a browser bar

### 6. "Let's go" confirmation / save
When a user taps "Let's go," they're redirected to Maps immediately. Consider:
- A brief interstitial confirming the selection
- A "save for later" option (bookmarks within session, or exported as list)

### 7. Sharing
"Send this place to a friend" — simple share sheet integration using Web Share API.

### 8. Backend / API layer
Currently the app is purely client-side. A lightweight backend would enable:
- Server-side places caching (reduce Overpass/third-party API calls)
- User accounts and saved places
- Analytics on what categories and places are popular
- Rate limiting and API key management (keep keys off the client)

### 9. Testing
No tests exist yet. Priority test coverage:
- Overpass query construction (correct syntax, correct radii)
- Distance calculation (Haversine function)
- Pool interleaving logic (correct category rotation)
- State transitions (loading → browsing → exhausted)
- Error handling paths

---

## Architecture notes

The app is currently a single `index.html` file. When introducing a backend or build step, suggested structure:

```
/
├── index.html          → entry point
├── src/
│   ├── app.js          → state management and app logic
│   ├── places.js       → places API abstraction layer
│   ├── geo.js          → geolocation + distance utilities
│   └── ui.js           → DOM rendering functions
├── styles/
│   └── main.css        → extracted styles
├── public/
│   ├── manifest.json   → PWA manifest
│   └── sw.js           → service worker
└── tests/
    └── *.test.js
```

---

## Design principles

- **One thing at a time.** Show one suggestion. Not a list. The decision overhead of a list is the problem this app solves.
- **No account friction.** A tourist doesn't want to sign up for anything. Geolocation is the only required input.
- **Category buttons are always visible.** The user can refine at any point without starting over.
- **Directions via Google Maps.** Users already know how to use it. Don't reinvent navigation.

---

## Deployment

Currently deployable as a static site with no build step:
- GitHub Pages (push `index.html` to `gh-pages` branch or enable Pages on `main`)
- Netlify / Vercel drag-and-drop
- Any static host

When a backend is added, reassess.

---

## Known limitations / technical debt

- Overpass API has rate limits; heavy usage in a single area may result in slow or failed fetches
- OSM data quality varies significantly by city — major tourist destinations are well-covered, rural areas are sparse
- No caching layer — every session fetches fresh from Overpass
- All state lives in memory; refreshing the page resets everything
- No error boundary around individual suggestion renders
- The `interleave()` function weights evenly across categories regardless of result count (e.g., if "See" returns 2 results and "Eat" returns 30, the pool will be thin on "Eat" suggestions early)
