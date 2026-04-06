# Post-Incident Communication Templates — Governance Lockout (April 2026)

> **NOTE:** CISO review is gated before publication. Each copy block must be
> approved before merging the STATUS: DRAFT marker.

---

## In-App Banner Copy

**STATUS: DRAFT**

**Heads up — recent service disruption resolved.**
Between April 4–6, 2026 an issue caused approval requests to be locked for up
to 36 hours. We have shipped fixes including automatic retry queues and an
emergency deployment bypass process to prevent this from happening again. If
you have approvals still showing as **Pending**, please open them and tap
"Re-submit" — they will process immediately.

---

## Discord Announcement Copy

**STATUS: DRAFT**

**@here — Post-Incident Update: Governance Lockout (April 4–6, 2026)**

**What happened**

Between Saturday April 4 and Monday April 6 (UTC), a configuration change
introduced a conflict in our approval-routing logic that caused new and
existing approval requests to become stuck in a **Pending** state for up to
36 hours. No data was lost and no approvals were silently rejected — they were
held, not dropped.

**What we fixed**

We have shipped the following systematic changes to prevent a recurrence:

- **Automatic retry queues** — approval requests that stall for more than
  5 minutes are now automatically requeued and retried, with alerts sent to
  on-call staff.
- **Emergency deployment bypass** — a documented, audited fast-track process
  now lets the on-call engineer push critical fixes within minutes rather than
  waiting for a standard release cycle.
- **Improved conflict detection** — our configuration validation pipeline now
  catches this class of routing conflict before it can reach production.

**Action required if you have Pending approvals**

1. Open the approval request in the app.
2. Tap **Re-submit**.
3. The request will process immediately — you do not need to start over.

If you run into any trouble re-submitting, reply here or open a support ticket
and we will sort it out manually.

We are sorry for the disruption. Thank you for your patience.

— The Unko team
