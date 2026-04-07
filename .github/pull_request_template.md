## Summary

<!-- Describe the change and why it was made -->

## Definition of Done

- [ ] `index.html` passes `htmlhint` linting (`npx htmlhint index.html`)
- [ ] Feature works on mobile (location, category selection, card display, share)
- [ ] Feature works on desktop (fallback clipboard share confirmed)
- [ ] No hardcoded API keys or secrets in source
- [ ] Foursquare API key is accessed only via `window.FOURSQUARE_API_KEY`
- [ ] Relevant `track()` events fire for any new user interactions
- [ ] PR title clearly describes the change

## Break-Glass Emergency Deploy (SEV-1 only)

> Only fill this section if this PR is labeled `SEV-1-BREAKGLASS`. Leave blank for normal PRs.

**BREAKGLASS_REASON:** <!-- Required: Describe the SEV-1 platform lockout this deployment resolves -->

**SRE_KEY_ID:** <!-- SRE authorized key ID from pipeline/break-glass/authorized-keys.json -->
**SRE_SIGNATURE:** <!-- Ed25519 signature (hex) over the PR HEAD commit SHA, produced by the SRE keyholder -->

**RELEASE_ENG_KEY_ID:** <!-- Release Engineering authorized key ID from pipeline/break-glass/authorized-keys.json -->
**RELEASE_ENG_SIGNATURE:** <!-- Ed25519 signature (hex) over the PR HEAD commit SHA, produced by the Release Engineering keyholder -->

- [ ] I confirm this PR changes ONLY infrastructure or webhook repair components (no feature code, no index.html)
- [ ] SRE keyholder has signed the HEAD commit SHA and recorded their key ID and signature above
- [ ] Release Engineering keyholder has signed the HEAD commit SHA and recorded their key ID and signature above (must be a different key from SRE)
