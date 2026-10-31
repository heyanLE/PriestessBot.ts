## Implemented

- [x] Add the type enum, descriptor registry and complete protocol/injection capability sets.
- [x] Replace v3 `preset` with `type` across authoring, projection and runtime Agent creation; accept the old JSON field as an input alias.
- [x] Keep internal preset selection and runner behavior unchanged.
- [x] Add a typed external runner contract and registry; dispatch external types before asking for a `ChatProvider`.
- [x] Validate declared protocols and reject CODEX activation until its runner is installed.
- [x] Report type capabilities and availability to the Dashboard; show an unavailable CODEX option without enabling it.
- [x] Run JVM regression tests and Dashboard type/build checks.

## Remaining integration

- [ ] P4 must configure and validate route-scoped injection modes before CODEX can be enabled.
- [x] P5 registers the JNI runner only for an explicit local experiment with a verified library path and SHA-256, and stops it after pipeline drain.
- [ ] Complete skills, trace, fault and NAS validation before CODEX is treated as production-ready.
