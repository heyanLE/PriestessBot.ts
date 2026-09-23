## Why

Workspace-owned agents and mixed platform configuration obscure where behavior, credentials, persona selection, and resource permissions come from. IM routing must select a complete independent Agent, while operators need execution-level evidence to diagnose actual model requests and tool outcomes.

## What Changes

- **BREAKING** Replace Workspace authoring with schema v3 application configuration: runtime, platform directory, IM instances, LLM connections, independent Agents, and shared resource catalogs.
- Route each IM message through an ordered, configurable route table to an Agent or built-in command; nonmatches never invoke a model. Resolve sender permissions from that IM instance.
- Give every Agent explicit LLM, configuration/temp directories, three skill sources and mount permissions, selected memory libraries, one persona, MCP servers, and tool policy.
- Add platform-owned memory libraries with scoped retrieval and writes; retain persona example separation as part of safe model context assembly.
- Add durable execution traces covering actual model input/output, tools, timing, errors, and usage, with IM/LLM/Agent filters and a Dashboard detail view.
- Reorganize the Dashboard around these entities while preserving its visual design. Plugin feature work is deferred.
- Directly migrate development configuration and data without backups, as explicitly requested. Do not run parallel legacy and v3 authoring systems.

## Capabilities

### New Capabilities
- `agent-im-runtime`: Independent Agent configuration, platform resources, ordered IM routing and sender permissions.
- `execution-trace-dashboard`: Durable execution chains and the reorganized configuration/log Dashboard.

### Modified Capabilities

Existing v2 Workspace behavior is replaced by the new capabilities rather than extended as a second authoring path.

## Impact

Configuration parsing/validation/activation, pipeline routing, all IM adapters, Agent composition, skill and memory/persona resolution, Dashboard APIs and Vue views, database schema, migration tooling, and deployment verification. AstrBot and deepseek-harness are read-only architectural references.
