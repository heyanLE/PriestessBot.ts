## Context

Every Agent tool source converges in `ReActRunner.handleToolCalls`, but result materialization is currently a private string helper and is only invoked for `ToolResult.success`. Directly changing every tool would duplicate policy and make plugin/MCP behavior inconsistent.

## Goals / Non-Goals

**Goals:**

- Bound every provider-visible tool observation before it enters conversation history.
- Preserve complete oversized success and failure payloads behind opaque conversation-scoped references.
- Keep small observations byte-for-byte compatible.
- Make pagination Unicode-safe and prevent the retrieval tool from producing another oversized result.
- Validate storage limits before configuration activation.

**Non-Goals:**

- Store every small result, persist results across restarts, or expose temporary paths.
- Change source-specific fetch limits or introduce a Dashboard file browser.
- Materialize tool calls executed outside an Agent/provider context, where no context overflow exists.

## Decisions

### 1. Materialize at the provider-bound convergence point

A dedicated `ToolResultMaterializer` will be called by `ReActRunner` for every executed tool result. This covers registered, platform-scoped, plugin-style, Workspace, and MCP tools while retaining the Agent-specific budgets and conversation identity available at that boundary.

### 2. Spill only oversized payloads

Results at or below `inlineTokens` remain unchanged. Larger payloads are written as UTF-8 to `ToolResultOverflowStore`; the observation contains a prefix bounded by `previewTokens`, an opaque result ID, success/error status, size metadata, expiry, and instructions for `read_tool_result`.

Both success output and failure error text use the same decision. Policy-denial metadata remains on `ToolResult`, while its potentially large human-readable error is materialized like any other provider observation.

### 3. Preserve compatibility and source truncation

The existing `TOOL_RESULT_OVERFLOW` marker remains recognizable. New status, byte, token, expiry, and next-offset fields are added without exposing a path. A source-level `"truncated": true` marker remains independent from runtime materialization.

### 4. Keep retrieval bounded and conversation-scoped

`read_tool_result` continues to require the owning conversation ID and uses Unicode code-point offsets. Its maximum requested window is reduced to a context-safe fixed ceiling so reading a stored result cannot recursively overflow the same context.

### 5. Reject invalid budgets during configuration compilation

Inline/preview tokens and TTL must be positive, preview must not exceed inline, single-result and total byte limits must be positive, and total capacity must be at least one result.

## Risks / Trade-offs

- Failed tool output may contain sensitive upstream text; storage remains temporary, path-hidden, TTL-bound, and conversation-authorized.
- Token counts are estimates; preview generation uses the same estimator as the materialization decision and remains below the configured budget.
- Oversized content above per-result capacity cannot be recovered; the model receives only a bounded preview and an unavailable marker.
