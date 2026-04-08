# Agent UX Copy Templates

Standard copy templates for AI pipeline agent failure and escalation states.
All templates are enforced to prevent approval fatigue and user confusion.

See **AI Pipeline & Agent Patterns** knowledge document for policy context.

---

## Template 1 — Waiting for Human

Used when the agent has completed an action and needs a human decision before it
can continue (e.g., after opening a PR, requesting an approval, or pausing due
to ambiguity).

**Required fields:** Context · Reason for pause · Decision options · AI recommendation

```
## AI Agent Paused — Action Required

**Context**
<What the agent did in this iteration — be specific about files changed, tests
run, or PRs opened.>

**Why we're paused**
<The specific condition that triggered the pause.  Do NOT expose internal
infrastructure details (secrets names, internal hostnames, etc.).>

**Your options**
1. <Option A — e.g., "Approve the PR to let the agent proceed">
2. <Option B — e.g., "Close the PR and provide new instructions">
3. <Option C — e.g., "Trigger the Break-Glass runbook if this is a SEV-1">

**AI recommendation**
<One sentence: what the agent thinks the right call is and why.>
```

### Example (CI fix iteration)

```
## AI Agent Paused — Action Required

**Context**
The agent pushed a fix for the failing `e2e-smoke-tests` job (PR #52, commit
`a3f9c12`).  CI is running; all other jobs passed.

**Why we're paused**
The agent is waiting for the `e2e-smoke-tests` job to complete before deciding
whether to retry or close the loop.

**Your options**
1. Wait — the agent will automatically continue once CI reports a result.
2. Close PR #52 and provide updated instructions if the approach is wrong.
3. Trigger the Break-Glass runbook if a SEV-1 governance lockout is blocking CI.

**AI recommendation**
Wait for CI — the fix targets the root cause identified in the logs (missing
env var in test harness).  No human action is needed at this point.
```

---

## Template 2 — Max Retries Reached

Used when the CI verification loop has exhausted all permitted retries (default:
3).  The agent MUST stop retrying and surface this template.  See
`pipeline/retry-token.js` for the enforcement mechanism.

**Required fields:** What was attempted · Clear "do this next" recovery path

```
## Max CI Retries Reached — Human Action Required

**What was attempted**
The agent retried the `<job_key>` CI job <N> time(s) (limit: <max>).
<One-sentence summary of each attempt and why it did not resolve the failure.>

**Summary**
All automated retry attempts have been exhausted without a passing CI run.

**Do this next**
1. Open the CI run at <link> and read the failure output carefully.
2. Determine whether the failure is flaky (transient) or deterministic (code
   bug).
3. **If transient:** manually re-run the failed job once via the GitHub Actions
   UI.
4. **If deterministic:** push a fix commit to the branch and re-trigger the
   agent with `retry_count=0`.
5. **If governance-blocked:** follow the Break-Glass runbook at
   `docs/runbooks/break-glass.md`.
```

### Example

```
## Max CI Retries Reached — Human Action Required

**What was attempted**
The agent retried the `e2e-smoke-tests` CI job 3 times (limit: 3).
- Retry 1: Added missing `DISCORD_WEBHOOK_SECRET` env var to the test runner.
- Retry 2: Pinned Node.js to v20.x after a v22 compatibility error.
- Retry 3: Fixed an import path typo surfaced by the updated Node version.

CI continued to fail after all three attempts.

**Summary**
All automated retry attempts have been exhausted without a passing CI run.

**Do this next**
1. Open the CI run at https://github.com/gabeshep/unko/actions/runs/12345 and
   read the failure output carefully.
2. Determine whether the failure is flaky (transient) or deterministic.
3. If transient: manually re-run the failed job once via the GitHub Actions UI.
4. If deterministic: push a fix commit and re-trigger the agent with
   `retry_count=0`.
5. If governance-blocked: follow the Break-Glass runbook at
   `docs/runbooks/break-glass.md`.
```

---

## Tone & Review Checklist

Before publishing any agent copy:

- [ ] No internal secret names, hostnames, or service credentials exposed.
- [ ] Failure is described factually — no blame language.
- [ ] Recovery steps are concrete and numbered.
- [ ] Tone is calm and direct — no alarm language unless the situation is a
      confirmed SEV-1.
- [ ] CISO/PM/UX sign-off obtained for any copy that reaches end-users (see
      Backend Observability & Monitoring Patterns — Incident Response).
