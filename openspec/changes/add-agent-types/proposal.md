## Why

`preset` described only the two internal loop variants. It could not honestly represent an external Codex engine or state which LLM protocols and tool-injection modes a type accepts. Choosing such a combination would fail at message time rather than during configuration validation.

This change supersedes the Agent identity and external-runner seam from `add-agent-runtime-scope` and `add-codex-agent-type`.

## What Changes

- Replace the v3 authoring field `agents[].preset` with `agents[].type`; accept the old field as a read-only input alias and write only `type` thereafter.
- Register `NORMAL`, `DEEPSEEK_HARNESS`, and `CODEX` as descriptors with engine, internal preset, protocol set, injection-mode set, and defaults.
- Add an `ExternalAgentRunner` seam. Internal Agents retain their current ReAct/Harness path; an external Agent never falls back to `ChatProvider` when its runner is unavailable.
- Report the type roster and capabilities from the server to the Dashboard. CODEX is off by default; the subsequent P5 implementation permits an explicit checksum-verified local experiment while production gates remain.

## Impact

Existing Agent behavior is unchanged; the two old preset values map by name to the same internal implementation. The Dashboard now uses `type` and shows CODEX only when the runtime reports it available. Provider protocol incompatibility and an unavailable type are rejected during configuration validation.
