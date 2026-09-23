## Why

Runtime behavior is currently derived from several overlapping configuration sources whose precedence, ownership, and activation timing are not consistently enforced. A unified model is needed so operators and maintainers can identify the authoritative source of every value, validate changes before activation, and obtain the same effective behavior from platform messages, Dashboard tests, reloads, and deployment entry points.

## What Changes

- Introduce separate typed models for persisted global configuration, workspace-owned behavior, environment overrides, message-level workspace selection, and the immutable effective runtime snapshot.
- Define one deterministic resolution pipeline with field-level provenance and explicit ownership; configuration layers may only set fields owned by that layer.
- Make Workspace the authoritative owner of Agent, sub-agent, tool, skill, MCP, persona, and memory behavior while global configuration owns process infrastructure, platforms, providers, and the default Workspace reference.
- Validate unknown fields, duplicate identifiers, missing provider/tool/agent references, unsupported values, and unsafe combinations before publishing or persisting a candidate.
- Replace implicit provider/tool fallbacks with explicit resolution errors and diagnostics.
- Make per-Agent tool policy executable as the intersection of Workspace policy, Agent policy, permission policy, and runtime availability.
- Separate persisted raw configuration from environment-derived effective configuration so environment secrets and overrides are never written back accidentally.
- Publish immutable, versioned effective snapshots atomically; in-flight messages keep their pinned snapshot while later messages use the newly activated version.
- Expose redacted raw/effective configuration, provenance, validation, preview, activation status, and restart requirements through the Dashboard API.
- **BREAKING** Remove or reject unsupported and duplicate configuration fields instead of silently ignoring them, including configuration placed in the wrong ownership layer.
- **BREAKING** Standardize all launch paths on an explicitly reported config path and the same resolver; missing or mismatched Provider, Agent, route, Workspace, and tool references no longer fall back silently.

## Capabilities

### New Capabilities

- `configuration-model`: Defines configuration ownership, source precedence, typed raw models, validation, provenance, redaction, immutable effective snapshots, and activation semantics.

### Modified Capabilities

- `config-hot-reload`: Changes reload from direct publication to validate, resolve, plan, and atomically activate with rollback and restart-required reporting.
- `workspace-runtime`: Makes Workspace the authoritative behavior scope and resolves directory configuration into validated versioned snapshots without ambiguous shallow inheritance.
- `pipeline`: Pins one effective configuration and Workspace snapshot at message entry and uses them consistently for every stage.
- `agent-loop`: Applies resolved generation settings and the effective per-Agent tool policy instead of dropping declared Agent configuration.
- `sub-agent-orchestration`: Resolves sub-agents from the active Workspace snapshot and uses the same selection/execution path for platform and Dashboard traffic.
- `dashboard-api`: Separates raw and effective config APIs and exposes redacted provenance, validation, preview, activation, and restart requirements.

## Impact

- Reworks `config`, `workspace`, `pipeline`, `agent`, `provider`, `tool`, `server`, and Dashboard configuration code.
- Changes the persisted JSON and Workspace YAML contracts and requires a migration path for existing local configurations.
- Replaces direct `ConfigCase.current()` consumption with immutable effective snapshot access or narrowly scoped runtime settings.
- Adds semantic validators, provenance/redaction models, activation planning, atomic persistence, and migration tests.
- Updates launcher scripts and deployment configuration so all entry points report and use the same explicit source model.
