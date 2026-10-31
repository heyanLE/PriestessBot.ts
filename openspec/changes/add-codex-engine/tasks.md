## Implemented and verified

- [x] Pin the reference fork and compile its public Rust engine without Python.
- [x] Build a macOS arm64 JNI library with bounded JSON and acknowledgement-based event polling.
- [x] Move Codex core futures onto 16 MiB Rust workers after a real resume smoke exposed JVM stack exhaustion.
- [x] Configure a custom Responses provider without Codex login and complete a mock model turn.
- [x] Receive and reply to a dynamic tool call through JNI; prove a later turn can narrow the manifest to empty.
- [x] Persist conversation rollout mapping, resume it after an engine restart, and rotate on model, instruction or provider-credential changes; a broken rollout starts a new thread with a visible continuity notice.
- [x] Map a native turn to `AgentResponse`; execute an authorized `MULTI` tool through `ToolCase`, remove it on a later `NONE` turn, and deny stale/duplicate/unknown calls and native approvals. A timed-out turn interrupts the thread.

## Remaining before activation

- [x] Register the Codex runner through the shared runtime registry only when the explicit local experimental switch, library path and SHA-256 match; stop it after pipeline drain.
- [ ] Bind dynamic tool events to the live caller, route, Agent policy and `ToolExecutor`. The runner checks caller role, current turn and call uniqueness, invokes `ToolCase`, and activation rejects native name collisions; cross-Agent lifecycle tests remain.
- [ ] Deliver only authorized skills, preserve persona updates, and report explicit continuity resets.
- [x] Correlate native turns, selected events and tool calls into execution traces with bounded metadata; record real per-turn token deltas from native cumulative usage without fabricating a single ChatProvider call.
- [ ] Test timeout, cancellation, duplicate calls, stale handles, concurrent close and fatal native faults. Timeout, duplicate calls, invalid JSON, stale handles and closing during a pending poll are covered; cancellation under live model I/O and fatal-fault isolation remain.
- [ ] Build and test a pinned Linux artifact for the NAS CPU architecture; audit production logs for credentials. The fake token was absent from local Codex-home files and verbose JVM test output, but production logging remains unverified.
- [x] Keep CODEX disabled by default and expose it in the Dashboard only when a locally pinned, checksum-verified native library is explicitly enabled.
- [ ] Qualify CODEX for NAS/production only after the remaining skill, trace, lifecycle and credential-log audits pass.
