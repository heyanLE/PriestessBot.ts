## Why

Tool outputs from built-in, platform, plugin, Workspace, and MCP tools can exceed the model context budget. The current overflow handling is embedded in `ReActRunner`, only spills successful results, and lacks complete store/reader/configuration tests. This leaves large failures unbounded and makes the shared behavior difficult to verify independently.

## What Changes

- Introduce one reusable materializer for every provider-bound tool result, regardless of tool source.
- Keep small results inline for compatibility, while storing oversized success or failure payloads in runtime temporary storage.
- Return a bounded preview plus an opaque, conversation-scoped result ID and retrieval metadata.
- Keep `read_tool_result(result_id, offset, limit)` as the single paginated retrieval tool and bound its own response window.
- Validate all tool-result storage budgets and add focused store, reader, runner, and configuration tests.

## Capabilities

### Modified Capabilities

- `tool-result-overflow`: Applies materialization consistently to oversized successful and failed tool observations and validates its complete configuration.

## Impact

- Affects ReAct tool-result handling, the temporary result store, Workspace Agent validation, and `read_tool_result`.
- Does not change individual tool implementations or persist result files across process restarts.
- Does not add a database migration or expose temporary file paths.
