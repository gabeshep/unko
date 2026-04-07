# SEV-1 Impact Report: Map / Places Search Failure

| Field | Value |
|---|---|
| Ticket | `6e1c2fc6` |
| Incident window | `2026-04-04T00:00:00Z` → `2026-04-06T23:59:59Z` |
| Generated | `2026-04-07` |
| Status | `DRAFT — Pending PM and SRE sign-off` |

---

## 1. Executive Summary

Between April 4 and April 6, 2026, all users who attempted a place search on the platform received an error message instead of results. The root cause was a control-plane database deadlock that prevented the `FOURSQUARE_API_KEY` environment variable from being provisioned to the `places-api-service`. As a result, every call to `GET /places/search` returned HTTP 503, and the frontend displayed a user-visible error. This report documents the incident timeline, root cause, affected user estimate, and recommendations to prevent recurrence. All user-impact figures are currently estimates pending retrieval of production logs and analytics data.

---

## 2. Incident Timeline

| Time (UTC) | Event |
|---|---|
| 2026-04-04T00:00Z (approx.) | Control-plane DB provisioning lockout begins; `FOURSQUARE_API_KEY` is not provisioned to `places-api-service`. |
| 2026-04-04 (ongoing) | `places-api-service` starts returning HTTP 503 on all `GET /places/search` requests. |
| 2026-04-04 (ongoing) | Frontend (`index.html:1304–1312`) catches non-ok fetch response, emits `track('search_failed')`, and calls `showError()` displaying: "Could not load nearby places. Check your connection and try again." |
| 2026-04-04 → 2026-04-06 | Users attempting place search encounter the error for the full duration of the incident window. |
| 2026-04-06T23:59:59Z | End of documented incident window. |
| Post-incident | Control-plane deadlock recovery; `FOURSQUARE_API_KEY` re-provisioned. Normal 200 responses resume. |

---

## 3. Root Cause

The failure chain was as follows:

1. **Control-plane DB deadlock** — The internal control-plane database entered a deadlock state, blocking the provisioning pipeline.
2. **`FOURSQUARE_API_KEY` not provisioned** — Because provisioning was blocked, the `FOURSQUARE_API_KEY` environment variable was absent from the `places-api-service` runtime environment.
3. **`places-api-service` returns HTTP 503** — `places-api-service/src/routes/places.js` checks for `FOURSQUARE_API_KEY` at request time. When the key is missing, the route handler returns HTTP 503.
4. **Frontend fetch fails** — `index.html` lines 1303–1312 wrap the fetch call in a `try/catch`. A non-ok response causes the catch block to execute.
5. **`search_failed` event emitted** — Line 1307: `track('search_failed', { category: state.activeCategory, error: err.message })`.
6. **`showError()` called** — Line 1308–1312: `showError('Could not load nearby places. Check your connection and try again.', 'Try Again →', fetchSuggestions)` is called, displaying the error to the user.

---

## 4. Error String Discrepancy

### Ticket description (incorrect)

Ticket `6e1c2fc6` states the frontend error message as:

> "Could not reach the places database. Check your connection and try again."

### Actual frontend string (`index.html:1308`)

The actual string displayed to users is:

> "Could not load nearby places. Check your connection and try again."

### Impact of the discrepancy

Any support-channel search, user report search, or log grep using the ticket's version of the string will return **zero results**. This could incorrectly suggest low user impact when the actual impact was broad. All searches in this retrospective use the corrected string. See `monitoring/analysis_scripts/sev1_support_channel_query.md` Section 4 for operator guidance.

The ticket description should be corrected to prevent confusion in future retrospectives or on-call handoffs.

---

## 5. Data Sources

| Source | Availability | Reliability | Notes |
|---|---|---|---|
| places-api-service Pino logs | Pending operator retrieval | High (structured JSON) | Filter: `statusCode == 503`, url contains `/places/search`. Run `sev1_places_503_analysis.sh` against production logs. |
| Client telemetry (`search_failed` events) | Pending analytics dashboard query | Medium (client-side, may miss offline users) | Event emitted at `index.html:1307`. Query dashboard for spike vs. 7-day baseline. |
| Discord `#support` thread volume | Available via manual search | Low-Medium (self-reported, sampling bias) | Use corrected error string: "Could not load nearby places". See operator guide for search procedure. |
| GitHub Issues | Available via search | Low (low reporting rate) | Search for `"Could not load nearby places" is:issue created:2026-04-04..2026-04-06`. |

---

## 6. Estimated Blast Radius

**All figures in this section are ESTIMATES, not confirmed counts.**

### Methodology

**Proxy metric:** The count of HTTP 503 responses on `GET /places/search` from backend Pino logs serves as a lower-bound proxy for the number of affected user interactions.

**Caveats:**
- A single user may generate multiple 503 responses (e.g., by retrying). The 503 count therefore overestimates unique users.
- Bot traffic and automated health checks have not been filtered; these would inflate the count.
- Users who experienced the error but did not retry are undercounted by retry-inflated counts.
- Client-side users who were offline when the error occurred may not appear in server-side logs at all.

**Confidence level: LOW** — until production log access is confirmed and the analysis script has been run against real data, no numeric estimates are published in this report.

**Pending actions:**

> `[PENDING: operator to run sev1_places_503_analysis.sh against production logs]`

> `[PENDING: analytics dashboard query for search_failed event spike vs. 7-day baseline (2026-03-28 → 2026-04-03)]`

Once both data points are available, update this section with:
- Confirmed 503 count (backend lower bound)
- Unique hashed request ID count (from analysis script)
- `search_failed` event count and spike ratio vs. baseline
- Revised confidence level

---

## 7. PII Scrubbing Methodology

The following controls apply to all data collected and reported in connection with this incident:

- **Session / request IDs:** `.reqId` values from Pino logs are SHA-256 hashed before any uniqueness counting or reporting. No raw request IDs appear in any committed artifact. See `monitoring/analysis_scripts/sev1_places_503_analysis.sh` for implementation.
- **Raw IP addresses:** `places-api-service` does not log `.req.remoteAddress` in its default Pino configuration. The analysis script explicitly suppresses any IP-containing fields from output. No raw IP addresses are present in any committed artifact related to this incident.
- **Usernames:** `places-api-service` logs do not contain usernames. No usernames are recorded in this report or in support-channel query results.
- **All figures are aggregated counts only.** No individual user records, sessions, or identifiers are stored in this report.

---

## 8. Recommendations

### R1 — Verify synthetic monitor covers 503 detection

PR #40 added a synthetic monitor for `/places/search`. Verify that the monitor's assertion checks for HTTP 503 specifically (not just connection failure) and that it would have alerted within the first hour of the incident window. If the current monitor only checks for a non-200 response, confirm the alert threshold and on-call routing are correctly configured.

### R2 — Add env-var presence health-check endpoint

`places-api-service` should expose a `/health` endpoint that returns HTTP 503 if `FOURSQUARE_API_KEY` is absent from the runtime environment (and HTTP 200 if present). This enables:
- Uptime monitors to alert before user-facing failures occur.
- Kubernetes / load-balancer readiness probes to remove the instance from rotation when the key is missing, preventing 503s from reaching users.
- On-call engineers to distinguish "key missing" from "Foursquare API down" without parsing application logs.

### R3 — Improve frontend error copy disambiguation

The current error message, "Could not load nearby places. Check your connection and try again.", is ambiguous: it does not distinguish between a client-side network failure and a server-side 503. Consider:
- When the backend explicitly returns HTTP 503, display a more specific message such as: "Place search is temporarily unavailable. Our team has been notified."
- Reserve the "Check your connection" phrasing for cases where the fetch itself fails (network error, no response).
- This would also reduce support confusion caused by users searching for "connection" issues when the problem is server-side.

---

## 9. Sign-off

This report is a draft and requires sign-off before being marked final.

| Role | Sign-off | Date |
|---|---|---|
| PM | `[ ] _________________` | `_________` |
| SRE | `[ ] _________________` | `_________` |
