# Configuration v2

The application accepts only schema version 2 configuration. The global JSON document owns process runtime, platform/provider connections, and the Workspace catalog. Each catalog directory owns a strict `config.yaml` for Agents, routing, tools, skills, MCP, personas, and memory.

Configuration path precedence is `--config`, `PRIESTESS_CONFIG_PATH`, then `config.json`. Startup, preview, apply, explicit reload, watched reload, Workspace reload, and backup restore all use `ConfigurationRuntimeService` and `ConfigurationCompiler`.

The runtime publishes immutable generations through `EffectiveConfigStore`. Every message acquires a lease, selects a catalog Workspace, and keeps the same runtime/Workspace generation through provider lookup and tool execution.

Dashboard authoring endpoints are:

- `GET /api/config/v2/raw`
- `GET /api/config/v2/effective`
- `POST /api/config/v2/preview`
- `PUT /api/config/v2`
- `GET/POST /api/config/v2/workspaces/{id}`
- `POST /api/config/v2/reload`
- `GET /api/config/v2/backups`
- `POST /api/config/v2/backups/{id}/restore`

Writes require the expected raw revision. Environment overrides and resolved credentials exist only in effective runtime state and are never serialized back to source files.

Legacy v1 boot, migration adapters, mutable full-config replacement, global Agent/sub-agent fields, and arbitrary message Workspace directories are not supported.

## Tool result materialization

Every provider-bound tool result uses the same context-budget check, including built-in, platform, plugin, Workspace, and MCP tools. Small success or failure payloads remain inline. An oversized payload is written to a runtime-owned temporary directory and replaced with a bounded preview plus an opaque, conversation-scoped `result_id`.

The Agent can retrieve later Unicode-safe windows with:

```text
read_tool_result(result_id, offset, limit)
```

`limit` is capped at 2,000 Unicode code points. References expire after the configured TTL, cannot be read from another conversation, do not reveal their file path, and are deleted at runtime shutdown. If the payload exceeds storage capacity, only a bounded preview and an unavailable marker enter model context.

Configure budgets per Agent in Workspace `config.yaml`:

```yaml
agents:
  - id: primary
    context:
      toolResults:
        inlineTokens: 2048
        previewTokens: 512
        ttlSeconds: 1800
        maxBytes: 4194304
        storeMaxBytes: 67108864
```

`previewTokens` must not exceed `inlineTokens`, all limits must be positive, and `storeMaxBytes` must be at least `maxBytes`.
