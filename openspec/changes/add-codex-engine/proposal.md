## Why

The existing internal loops cannot run a Codex Agent. The reference fork exposes an in-process Rust `Engine` that can submit turns and call back into PriestessBot's tools, avoiding a separate app-server process. The provider protocol axis and Agent type seam now make that engine expressible without treating it as an OpenAI Chat Completions adapter.

This change supersedes the engine transport portion of the removed `add-codex-agent-type` proposal. The selected transport is JNI over the fork's public Rust engine, not its earlier app-server alternative.

## What Changes

- Build a pinned JNI library with no Python feature, a bounded JSON boundary, durable event pumps and Rust-worker dispatch for deep Codex operations.
- Configure a custom Responses provider from the effective connection without calling Codex login.
- Persist a conversation-to-rollout mapping under each Agent's isolated Codex home. Serialize turns for one conversation; rotate native generations on provider credential changes and threads on instruction changes.
- Add a single-turn executor that maps terminal Codex output to `AgentResponse`. A `MULTI` route declares only current-turn authorized tools and dispatches callbacks through `ToolCase`; `NONE` declares none. Unexpected, stale or duplicate calls and native approval requests fail closed.
- Keep CODEX off by default. Permit a local experiment only with an explicit switch, existing native library and matching operator-supplied SHA-256; NAS packaging and production gates remain separate.

## Impact

The JVM remains the only application process. A native fault can still terminate that JVM, so CODEX is opt-in for local experiments and off for ordinary deployments. macOS arm64 mock Responses tests cover no-login messaging, a native tool round trip, a narrower next turn and persisted rollout resume; NAS Linux and production integration remain outstanding.
