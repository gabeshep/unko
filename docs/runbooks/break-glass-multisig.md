# Runbook: Break-Glass Multi-Sig Emergency Deploy (SEV-1)

**Audience:** SRE on-call, Release Engineering lead, CISO/CTO fallback keyholders  
**When to use:** A SEV-1 governance lockout has been declared and the normal PR approval flow is unavailable.

---

## Overview

The break-glass system provides two paths for emergency CI bypass, both requiring cryptographically signed **2-of-2 multi-sig authorization** from distinct authorized roles (SRE + Release Engineering). A single keyholder cannot satisfy both legs.

| Path | Trigger | Use case |
|------|---------|----------|
| **PR-label flow** | Label a PR `SEV-1-BREAKGLASS` | Infrastructure/webhook repair commits exist on a branch |
| **Direct dispatch flow** | `workflow_dispatch` on `break-glass.yml` | Arbitrary payload deployment without a PR |

Both paths write an immutable audit entry and fire a Discord alert to the Security channel. Neither path can be silently abused.

---

## Authorized Keys

Authorized public keys are registered in `pipeline/break-glass/authorized-keys.json`. Any change to this file requires **@ciso and @cto approval** (enforced via CODEOWNERS).

Current key IDs and roles:

| key_id | role(s) | identity |
|--------|---------|----------|
| `sre-oncall-2026` | `sre` | sre-oncall@example.com |
| `release-eng-lead-2026` | `release-engineering` | release-eng-lead@example.com |
| `ciso-fallback-2026` | `sre`, `release-engineering` | ciso@example.com |
| `cto-fallback-2026` | `sre`, `release-engineering` | cto@example.com |

> **Note:** All public keys are placeholders until replaced with real Ed25519 public keys. The workflow runs in `shadow_mode=true` (log-only) until real keys are substituted and `shadow_mode` is set to `false`.

---

## Signing a Payload

Both keyholders must sign **the same payload** using their Ed25519 private key. The signed value differs between the two paths:

- **PR-label flow:** Sign the PR HEAD commit SHA (40-character hex string, UTF-8 encoded)
- **Direct dispatch flow:** Sign the exact JSON deployment payload string (UTF-8 encoded)

### Generate a signature (Ed25519, using OpenSSL)

```bash
# Example: sign a commit SHA
PAYLOAD="a1b2c3d4e5f6..."  # the PR HEAD commit SHA

echo -n "$PAYLOAD" | openssl pkeyutl \
  -sign \
  -inkey /path/to/private_key.pem \
  -out sig.bin

xxd -p -c 256 sig.bin  # prints hex signature
```

Save the hex output — this is your `SRE_SIGNATURE` or `RELEASE_ENG_SIGNATURE`.

---

## Path 1: PR-Label Flow

### Step 1 — Confirm scope

The PR must only touch allowed paths:
```
terraform/  pipeline/  discord-sync-worker/  ticket-api-service/  monitoring/
```
Any other file will fail the `validate-scope` check.

### Step 2 — Collect signatures

Both keyholders independently sign the PR HEAD commit SHA (visible in the PR UI or via `git rev-parse HEAD`).

- **SRE keyholder:** produces `sre_key_id` and `sre_signature` (hex)
- **Release Engineering keyholder:** produces `release_eng_key_id` and `release_eng_signature` (hex)
- The two `key_id` values **must be different**.

### Step 3 — Fill in the PR body

Open the PR and complete the `## Break-Glass Emergency Deploy (SEV-1 only)` section:

```
**BREAKGLASS_REASON:** <clear description of the SEV-1 lockout being resolved>

**SRE_KEY_ID:** sre-oncall-2026
**SRE_SIGNATURE:** <hex signature from SRE keyholder>

**RELEASE_ENG_KEY_ID:** release-eng-lead-2026
**RELEASE_ENG_SIGNATURE:** <hex signature from Release Eng keyholder>
```

### Step 4 — Apply the label

Apply the `SEV-1-BREAKGLASS` label to the PR. This triggers the `Break-Glass Emergency Deploy (SEV-1)` workflow, which:

1. **validate-scope** — confirms only allowed paths are modified
2. **verify-multisig** — extracts signatures from the PR body and runs Ed25519 verification via `pipeline/break-glass/verify-multisig.js`; fails fast if either signature is invalid or both key IDs are the same
3. **emit-audit-log** — writes an immutable record (including signer identities) to the `/breakglass/audit-log` CloudWatch log group (retention = forever)
4. **breakglass-deploy** — deploys to GitHub Pages after the `breakglass` GitHub Environment gate is passed

### Step 5 — Approve the environment gate

A repository administrator must approve the `breakglass` GitHub Environment in the Actions UI. This is the final human gate before deployment.

---

## Path 2: Direct Dispatch Flow

Use this when there is no PR branch — e.g., the deployment payload is a configuration change applied directly.

### Step 1 — Define the payload

Agree on the exact JSON deployment payload string. Both keyholders will sign the identical string byte-for-byte.

```json
{"deploy": "rollback", "target": "github-pages", "ref": "main", "reason": "SEV-1 governance lockout"}
```

### Step 2 — Collect signatures

Both keyholders sign the UTF-8 bytes of the payload string (not a hash — `verify-multisig.js` signs the raw payload).

### Step 3 — Trigger the workflow

Navigate to **Actions → Break-Glass CI Deployment Bypass → Run workflow** and fill in:

| Input | Value |
|-------|-------|
| `payload` | The exact JSON payload string |
| `sre_key_id` | SRE keyholder's key ID |
| `sre_signature` | SRE hex signature |
| `release_eng_key_id` | Release Eng keyholder's key ID |
| `release_eng_signature` | Release Eng hex signature |
| `shadow_mode` | `false` to deploy (requires real keys); `true` to test |

---

## Post-Incident Requirements

After any break-glass invocation (shadow or live):

1. **Within 1 hour:** Notify the Security channel that break-glass was used; link the audit log entry.
2. **Within 24 hours:** File a postmortem explaining why the normal approval flow was unavailable.
3. **Within 72 hours:** Restore normal governance. Verify the approval queue is processing correctly.
4. **Rotation:** Rotate the signing key pair if there is any suspicion of key compromise. Update `authorized-keys.json` (requires @ciso + @cto approval).

---

## Key Contacts

| Role | Contact |
|------|---------|
| SRE On-Call | sre-oncall@example.com |
| Release Engineering Lead | release-eng-lead@example.com |
| CISO (fallback) | ciso@example.com |
| CTO (fallback) | cto@example.com |
