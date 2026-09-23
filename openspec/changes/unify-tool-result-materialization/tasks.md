## 1. Shared materialization

- [x] 1.1 Extract a reusable `ToolResultMaterializer` with one token estimator and structured reference metadata.
- [x] 1.2 Route successful and failed results from every ReAct tool source through the materializer.
- [x] 1.3 Keep small payloads unchanged and preserve source truncation separately.

## 2. Temporary store and reader

- [x] 2.1 Extend stored metadata with byte/token/creation details and deterministic capacity behavior.
- [x] 2.2 Bound `read_tool_result` pagination so retrieval cannot recursively overflow context.
- [x] 2.3 Verify ownership, expiry, eviction, Unicode pagination, and shutdown cleanup.

## 3. Configuration and verification

- [x] 3.1 Validate all Agent tool-result budgets and invalid relationships.
- [x] 3.2 Add runner tests for registered, scoped/MCP-style, oversized failure, capacity-unavailable, and source-truncated paths.
- [x] 3.3 Run an end-to-end fetch/overflow/read Agent smoke, the full JVM suite, Dashboard production build, and v2 launcher smoke test.
