# SEV-1 Support Channel Query Guide
**Incident:** places-api-service HTTP 503 on `/places/search`  
**Window:** 2026-04-04T00:00:00Z → 2026-04-06T23:59:59Z  
**Ticket:** `6e1c2fc6`

---

## Section 1: Search Strings

Use the following exact strings when searching support channels, issue trackers, and telemetry dashboards. Copy-paste these verbatim to avoid missed results.

### Frontend error copy (user-visible)

```
Could not load nearby places. Check your connection and try again.
```

> **Important — error string discrepancy:** The ticket description (`6e1c2fc6`) misquotes this string as:
> "Could not reach the places database. Check your connection and try again."
> That string does **not** appear in the codebase or in any user-facing surface.
> Searching for the ticket's version will return **zero results**. Always use the corrected string above.
> See Section 4 for full discrepancy notes.

### Backend error (server logs / error payloads)

```
FOURSQUARE_API_KEY is not configured
```

### Client telemetry event name

```
search_failed
```

---

## Section 2: Where to Search

### 2a. Discord `#support` Channel

1. Open the Discord server and navigate to `#support`.
2. Click the **Search** icon (magnifying glass, top-right) or press `Ctrl+F` / `Cmd+F`.
3. In the search bar, enter:
   ```
   Could not load nearby places in:#support
   ```
4. Apply a **date filter**:
   - Click the calendar icon in the search UI.
   - Set **After:** `04/03/2026` and **Before:** `04/07/2026`.
   - This scopes results to April 4–6, 2026 inclusive.
5. Scroll through all results. Note the message count but **do not record usernames** (see Section 3).
6. Repeat with the backend string for any operator-posted diagnostics:
   ```
   FOURSQUARE_API_KEY is not configured in:#support
   ```

### 2b. GitHub Issues

Use the following search queries on the repository's Issues tab or via GitHub search:

```
"Could not load nearby places" is:issue
```

```
"FOURSQUARE_API_KEY is not configured" is:issue
```

```
search_failed is:issue label:bug
```

To restrict to the incident date range, append a created filter:

```
"Could not load nearby places" is:issue created:2026-04-04..2026-04-06
```

### 2c. Analytics Dashboard (Client Telemetry)

1. Open the analytics dashboard (internal URL per team runbook).
2. Navigate to **Events** or **Custom Events**.
3. Filter by event name:
   ```
   search_failed
   ```
4. Set the time range to **2026-04-04 00:00 UTC → 2026-04-06 23:59 UTC**.
5. Note:
   - The total event count is the primary metric (lower-bound proxy for affected users).
   - Compare against the 7-day baseline (2026-03-28 → 2026-04-03) to quantify the spike.
   - Do **not** export raw session IDs; record aggregated counts only.

---

## Section 3: Aggregation Instructions

### Tallying results

| Source | What to record |
|---|---|
| Discord `#support` | Message count mentioning the error string. |
| GitHub Issues | Issue count opened during the incident window. |
| Analytics dashboard | Total `search_failed` event count; spike vs. 7-day baseline count. |

### PII scrubbing rules

- **Do not record usernames.** If a Discord message contains a username, record only the count.
- **Do not record raw session IDs.** If analytics data includes session IDs, aggregate before recording. If a session ID must be referenced for debugging, SHA-256 hash it first.
- **Do not record IP addresses.** The places-api-service Pino log analysis script (`sev1_places_503_analysis.sh`) suppresses IP output by design.
- All figures entered into the impact report (`docs/reports/sev1-map-failure-impact.md`) must be aggregated counts only.

---

## Section 4: Error String Discrepancy Note

### What the ticket says

Ticket `6e1c2fc6` describes the frontend error as:

> "Could not reach the places database. Check your connection and try again."

### What the code actually says

The actual string, at `index.html` line 1308, is:

```
Could not load nearby places. Check your connection and try again.
```

### Why this matters

Searching for the ticket's version of the string will return **zero results** in:

- Discord `#support` messages (users copy-paste what they see, not the ticket)
- GitHub Issues opened by users
- Any log-based text search

Any search coverage gap that appears to show "no user reports" during the incident window may be an artifact of using the wrong search string, not evidence of low user impact.

### Recommended action

All retrospective searches, impact reports, and runbook references must use the corrected string:

```
Could not load nearby places. Check your connection and try again.
```

The ticket description should be updated to reflect the correct string to prevent future confusion.
