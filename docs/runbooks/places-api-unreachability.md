# SRE Runbook: Places API Unreachability

**Ticket:** `fa1d76d2-synthetic-monitoring-places-api`
**Required Reviewers:** SRE on-call, Release Engineering
**Effort:** Small (< 30 minutes)
**Affected Services:** `places-api-service`

---

## Overview

This runbook covers the diagnosis and mitigation procedure when the `PlacesAPICanaryStale` alert fires, indicating that the places-api-service synthetic canary has not reported a successful health check within the last 3 minutes (3 consecutive 1-minute checks missed).

The canary exercises `GET /health/deep`, which validates both the presence of the `FOURSQUARE_API_KEY` environment variable and live connectivity to the Foursquare Places API. A stale canary may indicate a missing or rotated API key, a Foursquare upstream outage, or a service deployment failure.

---

## Prerequisites

- [ ] SRE on-call operator has access to the `places-api-service` host or Render dashboard.
- [ ] Operator can run `curl` against the production `places-api-service` endpoint.
- [ ] Operator has read access to the Render environment variable configuration for `places-api-service`.
- [ ] An active incident channel/thread is open; all actions taken must be narrated in real time.

---

## Risk Statement

**This runbook involves restarting a live service and verifying a third-party API key.** Restarting the service will cause a brief (~30-second) interruption to the places search feature for end users. Do not rotate or expose the `FOURSQUARE_API_KEY` value in logs, chat, or incident channels — reference it only by name.

---

## Alert Identification

The alert that triggers this runbook is `PlacesAPICanaryStale`, defined in `monitoring/prometheus/rules/governance_sync.yml`:

```
summary: 'Places API synthetic canary has not reported success in over 3 minutes'
description: 'The places-api-service canary last succeeded {{ $value | humanizeDuration }} ago
  (threshold: 3 minutes / 3 missed 1-minute checks). Check GET /health/deep on the
  places-api-service and verify Foursquare API connectivity.
  Runbook: docs/runbooks/places-api-unreachability.md'
```

The alert fires when `time() - places_api_canary_last_success_seconds > 180` is true for 1 minute.

---

## Triage Steps

### Step 1 — Check /health/deep directly

```bash
curl -s https://<places-api-service-host>/health/deep | jq .
```

Interpret the response:

| Response body | HTTP status | Meaning |
|---|---|---|
| `{ "status": "ok", "checks": { "api_key": "configured", "foursquare_connectivity": "ok" } }` | 200 | Service is healthy — canary may have been a transient blip. Wait 2 minutes and confirm metric updates. |
| `{ "status": "degraded", "checks": { "api_key": "missing", "foursquare_connectivity": "skipped" } }` | 503 | `FOURSQUARE_API_KEY` is missing from the environment. Go to **Diagnose → Missing API Key**. |
| `{ "status": "degraded", "checks": { "api_key": "configured", "foursquare_connectivity": "timeout" } }` | 503 | API key is present but Foursquare is unreachable. Go to **Diagnose → Connectivity Issue**. |
| `{ "status": "degraded", "checks": { "api_key": "configured", "foursquare_connectivity": "http_<N>" } }` | 503 | Foursquare returned an unexpected HTTP status code `N`. Go to **Diagnose → Connectivity Issue**. |

---

## Diagnose

### Missing API Key

1. Open the Render dashboard and navigate to the `places-api-service` environment variables.
2. Confirm that `FOURSQUARE_API_KEY` is present and non-empty. Do **not** log or paste its value.
3. If the variable is absent: a recent deploy may have dropped it, or it was deliberately removed. Proceed to **Mitigate → Restore API Key**.

### Connectivity Issue (timeout or http_*)

1. Check the [Foursquare API status page](https://status.foursquare.com/) for active incidents affecting the Places API (`/v3/places/search`).
2. Search `places-api-service` logs for `foursquare_timeout` events in the last 30 minutes:

   ```bash
   # Render log stream (replace with your log aggregation query)
   curl -s https://<log-aggregator>/query \
     --data '{"service":"places-api-service","event":"foursquare_timeout","since":"30m"}' | jq .
   ```

3. If logs show sustained `foursquare_timeout` events and the Foursquare status page shows an active incident, proceed to **Escalation**.
4. If the status page is green and timeouts are intermittent, try a service restart first (**Mitigate → Restart Service**).

---

## Mitigate

### Restart Service Container

1. Navigate to the Render dashboard → `places-api-service` → **Manual Deploy** (or trigger a redeploy).
2. Wait for the service to reach `Live` status (~60 seconds).
3. Re-run the triage curl command against `/health/deep` and confirm a `200 ok` response.

### Restore or Verify FOURSQUARE_API_KEY

1. In the Render dashboard, open `places-api-service` → **Environment**.
2. Verify `FOURSQUARE_API_KEY` is set. If missing, add it from the team secrets vault (1Password / AWS Secrets Manager — do **not** copy from chat or email).
3. Save the environment change and trigger a redeploy.
4. After the redeploy, re-check `/health/deep`.

### Check Render Deploy Status

1. Open the Render dashboard → `places-api-service` → **Events** tab.
2. Confirm the most recent deploy succeeded. If the most recent deploy shows a failure, roll back to the previous successful deploy using **Rollback** in the Render UI.

---

## Escalation

If the Foursquare status page confirms an active upstream incident affecting `/v3/places/search`:

1. Open a **P1 support ticket with Foursquare** at https://support.foursquare.com/ referencing the affected endpoint and the time window of failures.
2. Post the Foursquare incident URL in the active incident channel.
3. Consider enabling the shadow-mode procedure below to suppress downstream alert noise while the upstream outage is in progress.

---

## Confirm Recovery

1. Re-run the deep health check and confirm a 200 response:

   ```bash
   curl -s https://<places-api-service-host>/health/deep | jq .
   # Expected: { "status": "ok", "checks": { "api_key": "configured", "foursquare_connectivity": "ok" } }
   ```

2. Wait up to 2 minutes for the canary to complete its next scheduled run and update `places_api_canary_last_success_seconds`.
3. Verify the Prometheus alert resolves in Alertmanager (the `PlacesAPICanaryStale` alert should transition to `inactive`).
4. Post a confirmation message in the incident channel with the timestamp of recovery.

---

## Shadow-Mode Procedure

To suppress `PlacesAPICanaryStale` alert noise during a known Foursquare upstream outage without destroying the canary infrastructure:

**Enable shadow mode (pause canary firing):**

1. In `terraform/synthetic-monitors/canary_cron.tf`, set `places_api_canary_enabled = false` in the relevant `terraform.tfvars` file.
2. Open a PR, get approval from a second SRE, and apply via the standard Terraform pipeline.
3. The EventBridge rule for `places-api-service-canary` will be removed, stopping canary invocations and preventing stale-metric alerts from firing.

**Disable shadow mode (re-enable canary):**

1. Restore `places_api_canary_enabled = true` in `terraform.tfvars`.
2. Open a PR and apply via Terraform pipeline.
3. Confirm the canary resumes by checking that `places_api_canary_last_success_seconds` updates within 2 minutes of the next scheduled run.

---

## Rollback SLA

If this runbook execution (e.g., a forced redeploy or API key rotation) causes a regression, the **15-minute rollback SLA** applies:

1. Disable the canary via `places_api_canary_enabled = false` (shadow-mode procedure above) to stop alert noise.
2. Roll back the `places-api-service` deploy to the last known-good version in the Render dashboard.
3. Verify `/health` (shallow) and `/health/deep` return expected responses.
4. File a post-incident review within 24 hours documenting the timeline and root cause.

---

*Last validated: staging | Required re-validation: after any change to `FOURSQUARE_API_KEY` rotation policy or Foursquare API version upgrade.*
