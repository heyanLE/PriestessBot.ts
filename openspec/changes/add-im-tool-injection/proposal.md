## Why

The incoming IM route selects the Agent, but until now it could not select the shape of platform tools exposed to that turn. A Codex route must be able to run with no IM tools while its native permission bridge is incomplete, without changing existing internal routes.

This change supersedes the route-scoped injection part of the removed `add-agent-runtime-scope` and `add-codex-agent-type` proposals.

## What Changes

- Add optional `toolInjectionMode` to Agent route actions. Omission means `MULTI`, preserving existing behavior. Command routes carry no injection setting.
- Define the four-mode vocabulary (`NONE`, `SINGLE`, `MULTI`, `SKILL`) and validate route selections against the server's Agent type capabilities.
- Implement `NONE` and `MULTI` for IM platform tools at the per-request assembly point. Keep `SINGLE` and `SKILL` unavailable until their dispatcher and skill contracts are implemented.
- Show supported modes in the Dashboard using the server-reported Agent type roster.

## Impact

Existing routes keep one tool per platform capability. An explicit `NONE` route excludes IM platform tools from that message's Agent context. Core Agent and selected MCP tools retain their own policy. A route requesting an unimplemented mode fails configuration validation instead of silently using another mode.
