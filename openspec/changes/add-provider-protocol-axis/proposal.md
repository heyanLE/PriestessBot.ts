## Why

An LLM connection currently identifies its vendor but cannot state its wire protocol. Codex requires OpenAI Responses, while the internal OpenAI-compatible adapter previously sent only Chat Completions. Without a protocol axis, a Responses-only endpoint cannot be configured or validated before use.

This change supersedes `add-openai-responses-provider` and the provider portion of the removed `add-agent-runtime-scope` and `add-codex-agent-type` proposals.

## What Changes

- Add optional `llms[].protocol` with a vendor-specific default. Existing OpenAI connections remain Chat Completions.
- Implement internal OpenAI Responses request and response mapping while keeping `/models` discovery and credential resolution shared.
- Report the resolved protocol on the redacted effective connection and offer server-reported protocol choices in the Dashboard.
- Reject unknown or unsupported protocol values before activation.
- Leave external engine transport to `add-codex-engine`: it consumes the same endpoint, protocol and credential without going through `ChatProvider`.

## Impact

Configuration v3 gains one optional field. Existing connections keep their behavior. Internal Responses conversations preserve text, function calls, function outputs and usage; reasoning items, encrypted reasoning state, hosted tool items and multimodal content are not represented in the shared DTO. A connection test still probes `/models`, so it does not prove the endpoint implements `/responses`.
