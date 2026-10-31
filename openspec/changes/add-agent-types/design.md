## Decisions

The public selector is `AgentType`; `AgentPreset` is retained only inside the internal engine's prompt and runner implementation. A type descriptor contains `engine`, `internalPreset`, `llmProtocols`, `toolInjectionModes`, defaults and availability. The registry refuses a missing type, empty protocol set or inconsistent internal preset.

The v3 JSON decoder accepts `preset` as an alias for `type`, while serialization emits only `type`. This preserves a running local v3 configuration without a second saved schema or a dual-write period. The v2-to-v3 migration copies the previously selected type by name.

The external runner receives one `ExternalAgentTurn` containing the pinned Agent context, effective provider connection and exact current user content. It returns the existing `AgentResponse`. `ProcessStage` resolves the connection first, dispatches external types through the registry, and requests a `ChatProvider` only for internal types. The registry is empty in this change; CODEX activation is rejected until P5 installs its runner and P4 supplies route-scoped authorization.

The Dashboard reads `/api/agent-types` and protocol choices from the server. It does not maintain independent capability lists. It keeps a currently stored unknown value visible but disables choosing a type the runtime marks unavailable. Internal budget buttons remain available only for internal types. CODEX's compression, tool-result and step-budget fields are reported as inert.
