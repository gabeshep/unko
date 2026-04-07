# SRE Runbook: Control-Plane Deadlock Recovery & Break-Glass DB State Transition

**Ticket:** `8414c322-fd6b-4388-85a6-0ab4e327b221`
**Required Reviewers:** CISO, Release Engineering
**Effort:** Small (1 day)
**Affected Services:** `ticket-api-service`, `discord-sync-worker`, `permaship-dashboard`

---

## Overview

This runbook covers the emergency procedure for manually transitioning ticket states from `PENDING HUMAN REVIEW` to `APPROVED` when the Discord-based approval webhook is severed and the governance loop is deadlocked (i.e., the broken pipeline cannot approve its own fix).

Every execution of this runbook is a **break-glass event** and requires 2-person authorization plus an immutable audit log entry.

---

## Prerequisites

- [ ] Two authorized operators are online and ready to co-sign:
  - **Operator 1:** SRE on-call (must hold an `sre_key_id` GPG/SSH key registered in the key registry)
  - **Operator 2:** Release Engineering (must hold a `release_eng_key_id` GPG/SSH key registered in the key registry)
- [ ] Both operators have authenticated to the production `ticket-api-service` host or have `psql` access to the production database via the bastion host.
- [ ] An active incident channel/thread is open; all actions taken here must be narrated in that channel in real time.
- [ ] The CI `SEV-1-BREAKGLASS` PR label has been applied to the blocked pull request (triggers the Break-Glass CI bypass path in `pipeline/ci.yml`).

---

## Risk Statement

**Unauthorized or solo execution of this runbook bypasses standard human-in-the-loop approval gates and may result in unapproved code reaching production.** The 2-person authentication requirement and immutable audit log (enforced at the database trigger level) are the primary controls against misuse. Do not proceed without both signatories present.

---

## Step 1 — Identify Stuck Tickets

Query the approvals queue to find all tickets currently blocked in `PENDING HUMAN REVIEW`:

```bash
# Via the ticket-api-service REST API (preferred — verifies API layer is healthy)
curl -s https://<ticket-api-service-host>/approvals/queue | jq .
```

Expected response shape:
```json
{
  "count": <N>,
  "items": [
    { "id": "<uuid>", "status": "pending", "tenant_id": "...", "created_at": "..." },
    ...
  ]
}
```

If the API is unreachable, fall back to a direct DB query:

```sql
-- Direct DB fallback (bastion psql session)
SELECT id, status, tenant_id, created_at
FROM approvals
WHERE status = 'pending'
  AND tenant_id IS DISTINCT FROM '__synthetic__'
ORDER BY created_at ASC;
```

Record the `id` values of every ticket that must be manually advanced. Paste the full list into the incident channel.

---

## Step 2 — Compute Payload Hash

Before writing any audit log entry, both operators must independently compute and verify the SHA-256 hash of the deployment payload or the list of ticket IDs being approved. This binds the audit record to exactly what was authorized.

```bash
# Replace <ticket-ids-json> with the canonical JSON list of ticket IDs, e.g. '["<uuid1>","<uuid2>"]'
echo -n '<ticket-ids-json>' | sha256sum
# Example output: a3f8c1...  -
```

Both operators must confirm they see the same hash before proceeding.

---

## Step 3 — Write the Break-Glass Audit Log Entry (2-of-2 Sign-off)

Post a single audit record to the `break_glass_audit_log` table via the `ticket-api-service` API. This record is **append-only** — the database trigger `tg_break_glass_audit_immutable` blocks any subsequent UPDATE or DELETE.

```bash
curl -s -X POST https://<ticket-api-service-host>/break-glass/audit \
  -H "Content-Type: application/json" \
  -d '{
    "payload_hash":         "<sha256-hex-from-step-2>",
    "sre_key_id":           "<sre-gpg-or-ssh-key-id>",
    "sre_identity":         "<sre-operator-email>",
    "release_eng_key_id":   "<release-eng-gpg-or-ssh-key-id>",
    "release_eng_identity": "<release-eng-operator-email>",
    "shadow_mode":          false
  }'
```

Expected response:
```json
{ "ok": true, "id": <audit-log-row-id> }
```

Record the returned `id` in the incident channel. **This step must succeed before any DB state is changed.** If this call fails (e.g., `ticket-api-service` is down), use the direct SQL fallback:

```sql
-- Direct DB fallback — run inside a transaction so the INSERT is atomic
BEGIN;
INSERT INTO break_glass_audit_log
  (payload_hash, sre_key_id, sre_identity, release_eng_key_id, release_eng_identity, shadow_mode)
VALUES
  ('<sha256-hex>', '<sre-key-id>', '<sre-email>', '<re-key-id>', '<re-email>', false)
RETURNING id;
-- Confirm the returned id, then:
COMMIT;
```

---

## Step 4 — Transition Ticket States

With the audit record committed, advance each identified ticket from `pending` to `approved`. Run inside a single transaction so the batch is atomic.

```sql
BEGIN;

UPDATE approvals
SET
  status     = 'approved',
  updated_at = NOW()
WHERE id IN ('<uuid1>', '<uuid2>' /*, ... */)
  AND status = 'pending'
  AND tenant_id IS DISTINCT FROM '__synthetic__';

-- Verify: expected row count must match the ticket list from Step 1
-- If the count does not match, ROLLBACK and investigate before retrying.

COMMIT;
```

If the count returned by `UPDATE` is less than expected, **ROLLBACK** immediately, verify no tickets changed state between Step 1 and now, then re-run.

---

## Step 5 — Post-Override Verification

After the state transition, verify that the API layer and CI pipelines have ingested the change correctly.

### 5a — API-layer sync check

```bash
# The queue count should now reflect the number of tickets just approved
curl -s https://<ticket-api-service-host>/approvals/queue | jq '.count'
# Expected: previous count minus the number of tickets you just approved
```

A mismatch here indicates a session/auth mapping failure in the API layer (see *Backend Observability & Monitoring Patterns* — state verification must hit the actual endpoint, not a duplicate DB query).

### 5b — Audit log integrity check

```bash
curl -s https://<ticket-api-service-host>/approvals/audit-log | jq '.items | length'
```

Confirm the audit-log endpoint returns the expected number of entries and the most recent entry reflects this break-glass event.

### 5c — CI pipeline re-trigger

Re-run the blocked CI workflow on the affected pull request:

```bash
gh workflow run ci.yml --ref <branch-name>
# Or re-push a no-op commit to trigger the pipeline:
git commit --allow-empty -m "ci: trigger post-break-glass re-run"
git push
```

Monitor the GitHub Actions run. All jobs (`validate`, `secret-scan`, `dependency-audit`, `webhook-integration-tests`) must pass or reach their expected shadow-mode state before the PR is eligible to merge.

### 5d — Prometheus metric confirmation

Verify the `break_glass_invocations_total` counter incremented with `shadow_mode="false"`:

```bash
curl -s https://<ticket-api-service-host>/metrics | grep break_glass_invocations_total
# Expected: break_glass_invocations_total{shadow_mode="false"} 1 (or incremented by 1)
```

---

## Step 6 — Security Notification

The break-glass event must be reported to the Security channel within 15 minutes of completion:

- Incident channel thread link
- Audit log entry ID from Step 3
- Ticket IDs that were transitioned
- Both operator identities and key IDs
- Timestamp of state change
- Reason the normal approval pipeline was unavailable

---

## Reversibility — Roll Back an Erroneously Approved Ticket

If a ticket was advanced in error, revert it back to `pending`:

```sql
BEGIN;

-- Step R1: write a new audit log entry documenting the rollback
INSERT INTO break_glass_audit_log
  (payload_hash, sre_key_id, sre_identity, release_eng_key_id, release_eng_identity, shadow_mode)
VALUES
  ('<sha256-of-rollback-payload>', '<sre-key-id>', '<sre-email>', '<re-key-id>', '<re-email>', false)
RETURNING id;

-- Step R2: revert the state (requires the same 2-person sign-off as the original transition)
UPDATE approvals
SET
  status     = 'pending',
  updated_at = NOW()
WHERE id IN ('<uuid-of-erroneous-ticket>')
  AND status = 'approved'
  AND tenant_id IS DISTINCT FROM '__synthetic__';

COMMIT;
```

Repeat the verification steps (5a–5d) after the rollback.

---

## Staging Validation Procedure

Before this runbook is relied upon in production, validate it in staging:

1. Create a synthetic `pending` approval record (`tenant_id = '__test__'`, not `'__synthetic__'` to avoid CI filter exclusion).
2. Execute Steps 1–5 against the staging environment.
3. Confirm the state transition, audit log entry, and Prometheus counter are all consistent.
4. Execute the rollback procedure (Step 6) and confirm the ticket returns to `pending`.
5. Obtain CISO and Release Engineering sign-off on the staging run results before marking this runbook production-ready.

---

## Dead-Letter Queue (DLQ) Recovery

If the governance deadlock is caused by Discord webhook failures rather than a control-plane DB issue, check the DLQ first before escalating to a manual DB transition:

```bash
curl -s https://<ticket-api-service-host>/approvals/dead-letter | jq .
```

If failed payloads are present, the DLQ's automatic retry with exponential backoff may resolve the blockage without requiring a manual state override. Only proceed to Steps 1–6 above if the DLQ is empty or retries are exhausted.

---

## Rollback SLA

If this runbook execution itself causes a pipeline regression (e.g., CI desync after the state transition), the 15-minute rollback SLA applies:

1. Revert any erroneously approved tickets to `pending` (Step 6).
2. Terminate any active subagents or automation triggered by the false-positive approval signal.
3. Restore default routing and re-engage the standard approval webhook path.
4. File a post-incident review within 24 hours.

---

*Last validated: staging | Required re-validation: after any schema change to `approvals` or `break_glass_audit_log` tables.*
