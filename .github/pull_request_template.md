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

- [ ] I confirm this PR changes ONLY infrastructure or webhook repair components (no feature code, no index.html)
- [ ] Two-person authorization (SRE + Release Engineering) will be obtained via the `breakglass` GitHub Environment gate
