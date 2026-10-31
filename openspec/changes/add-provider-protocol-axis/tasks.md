## Implementation

- [x] Add the protocol field, defaults, effective projection and unknown/unsupported validation for v3 and projected configuration.
- [x] Propagate the resolved protocol through both ProviderController creation paths.
- [x] Implement internal OpenAI Responses request construction and output parsing, preserving the existing Chat Completions default.
- [x] Expose server-reported protocol choices in the Dashboard and document the field and fidelity boundary.
- [x] Test protocol defaults and rejection, Responses text/tool/usage mapping, and the unchanged Chat Completions path.
- [x] Run the full JVM suite and Dashboard build.

## Remaining verification

- [ ] Exercise a plain turn and a function-call turn against an actual Responses-compatible endpoint; `/models` alone is insufficient.
- [ ] In P5, audit the fork's runtime bearer-token override for rollout or log persistence before enabling a real Codex credential.
