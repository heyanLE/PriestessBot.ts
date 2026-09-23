## Context

The current implementation has one mutable `PriestessConfig` serving several incompatible roles: persisted JSON, environment-resolved settings, Dashboard DTO, and runtime state. Workspace YAML then repeats Agent, provider, tool, persona, and memory settings, while message metadata and launch scripts can choose different directories. Controllers consume different slices at different times, some declared fields are dropped during Agent construction, and missing provider/tool references can fall back silently. As a result, the source and activation state of an effective value cannot be answered consistently.

This change treats configuration as a compilation problem. Human-authored source documents are parsed and validated into an immutable runtime snapshot. Runtime components consume only the compiled snapshot, never raw files or environment variables.

## Goals / Non-Goals

**Goals:**

- Give every configurable field exactly one owning source and a deterministic resolution rule.
- Separate persisted values, secret/environment resolution, desired state, and active runtime state.
- Make invalid, ignored, duplicated, or unresolved configuration observable before activation.
- Ensure platform traffic, Dashboard tests, and background reloads execute the same Agent and tool policy.
- Publish versioned immutable snapshots atomically and pin one snapshot for the lifetime of a message.
- Provide a staged migration from the existing JSON/YAML without silently changing behavior.
- Organize the implementation into small source, model, validation, resolution, activation, and API boundaries.

**Non-Goals:**

- Replace JSON/YAML with a configuration service or database.
- Add a general-purpose expression language or arbitrary per-message configuration overrides.
- Implement remote secret storage; the model only defines secret references and redaction boundaries.
- Make every setting hot-reloadable. Restart-bound settings remain explicit desired state until restart.
- Redesign Agent routing, permissions, or Workspace discovery beyond what is needed for unambiguous configuration.

## Decisions

### 1. Divide configuration by ownership instead of allowing every source to override every field

There are four input types and one compiled output:

| Input | Owns | Must not own |
| --- | --- | --- |
| Global app file | process runtime, server, database, plugins, platform instances, provider connections, Workspace catalog and default Workspace id | Agent behavior, Workspace tools, persona, memory |
| Environment | an allowlisted override for deployment-bound global fields and secret values referenced by name | arbitrary JSON paths, Workspace behavior |
| Workspace directory | Agents, sub-agents, routing, generation/context settings, tool policy, skills, MCP, persona, memory | server, database, plugins, platform credentials, provider connections |
| Message context | a Workspace id selector and routing facts such as platform/user/group | file paths or behavior overrides |
| Effective snapshot | fully resolved, validated, redacted runtime values plus provenance | persisted authoring state |

This removes cross-layer shallow merge. A field in the wrong document is a validation error, not an ignored value. Workspace selection precedence is explicit: message-selected Workspace id, then a matching catalog rule, then platform default Workspace id, then global default Workspace id. Each selected id resolves through the global Workspace catalog; messages cannot inject an arbitrary directory.

Alternative considered: retain one broad config object and document an override order. This was rejected because field-by-field override semantics remain difficult to enforce and continue mixing deployment concerns with conversational behavior.

### 2. Introduce versioned source models with stable identifiers

The persisted global model is `AppConfigDocument`:

```text
AppConfigDocument
  schemaVersion
  runtime { server, database, plugins, reload }
  platforms[] { id, type, enabled, defaultWorkspaceId?, settings }
  providers[] { id, type, enabled, endpoint, credentialRef, settings }
  workspaces { defaultWorkspaceId, entries[] { id, directory, enabled, selectionRules[] } }
```

Provider entries describe connection/adaptor concerns. Model selection and generation settings belong to an Agent definition, so a provider no longer contains a second authoritative Agent model.

The Workspace model is `WorkspaceConfigDocument`:

```text
WorkspaceConfigDocument
  schemaVersion
  id, name, enabled
  primaryAgentId
  agents[] {
    id, displayName, providerRef, model,
    generation { temperature, maxOutputTokens },
    context { compression, maxRounds, maxTokens },
    execution { maxSteps, toolTimeoutMs },
    personaRef?, toolPolicy
  }
  orchestration { enabled, defaultAgentId?, routes[] }
  toolPolicy
  skills[]
  mcpServers[]
  personas[]
  memory
```

Lists use explicit ids so validation errors and provenance paths remain stable and display order remains author-controlled. Duplicate ids are errors. Runtime code indexes validated lists into immutable maps.

Each document has `schemaVersion`. Decoders reject unknown fields. Migration is a separate typed transformation from a known older schema; it is never implemented by enabling `ignoreUnknownKeys`.

### 3. Treat environment values and secrets as typed inputs, not mutations of the persisted model

`EnvironmentOverrideSource` exposes only an allowlist of typed keys such as the config path, server bind/token, database path, plugin path, and provider secret variables. General environment-to-property reflection is prohibited.

Persisted provider credentials use `credentialRef`, initially supporting `env:VARIABLE_NAME`. A migration-only inline secret form may be read with a warning, but it is never emitted by Dashboard APIs or written by an automatic migration. Secret values are resolved into guarded runtime credentials and represented in provenance only by source kind and variable name, never by value.

The resolver keeps `RawConfigState`, `DesiredConfig`, and `EffectiveRuntimeSnapshot` as distinct types. Saving `RawConfigState` cannot persist environment-derived values because those values are structurally absent from that type.

Alternative considered: overlay environment values onto `AppConfigDocument` as today. This was rejected because the same object can later be serialized and leak deployment values or secrets.

### 4. Compile configuration through one deterministic resolver pipeline

All startup, reload, Dashboard preview, Dashboard apply, and Workspace reload paths use `ConfigurationCompiler`:

1. Read the explicitly resolved global path and record its source.
2. Decode strict syntax into a versioned source document.
3. Run an explicit schema migration in memory when needed.
4. Validate global identifiers, value ranges, ownership, and local references.
5. Resolve allowlisted environment overrides and credential references.
6. Resolve the Workspace catalog and strictly decode each enabled Workspace.
7. Validate cross-document provider, Agent, route, persona, skill, MCP, and tool references.
8. Resolve runtime resources and effective per-Agent tool sets.
9. Build provenance, source fingerprints, diagnostics, and an activation plan.
10. Atomically publish the candidate only if all error-level diagnostics are absent.

There is no fallback to the first provider, primary Agent, similarly named tool, or default object after a reference error. Optional resources have explicit absence semantics; required references fail compilation.

The implementation is split by responsibility:

```text
config/model       versioned source and effective data classes
config/source      file, environment, and Workspace readers
config/migration   explicit schema-to-schema transformations
config/validation  syntax-independent validators and diagnostics
config/resolve     compiler, provenance, resource and tool resolution
config/runtime     snapshot store and activation coordinator
config/api         redacted views and commands used by Dashboard
```

`ConfigCase` remains a narrow façade. Feature controllers receive `EffectiveConfigStore` or a feature-specific effective view; they do not read files, environment variables, or `ConfigController.current()`.

### 5. Make tool authorization a compiled intersection

For Agent `A` in Workspace `W`, the advertised and executable tool set is:

```text
available runtime tools
  ∩ W.toolPolicy
  ∩ A.toolPolicy
  ∩ resolved sender permission policy
```

An allowlist narrows access; a denylist always removes access; allowed risk levels filter after the named policy. Unknown tool ids and contradictory policy entries fail validation. The exact same `EffectiveAgent.toolSet` feeds prompt construction and `ToolExecutor`; the model is never shown a tool that the executor will reject solely because a different config path was used.

MCP declarations are connected while compiling a Workspace snapshot. A required MCP server failure blocks that Workspace candidate; an explicitly optional server produces a diagnostic and contributes no tools. This distinction prevents parsed-but-unused MCP configuration.

### 6. Publish immutable active snapshots and represent desired-versus-active state explicitly

`EffectiveRuntimeSnapshot` contains a monotonically increasing version, source fingerprint, load timestamp, resolved global runtime views, Workspace snapshots, provenance index, and non-secret diagnostics. A message pins both the global snapshot version and selected Workspace snapshot at pipeline entry. Every stage, Agent, provider lookup, and tool execution uses that pinned reference.

`ConfigActivationCoordinator` classifies diffs:

- `LIVE`: Agent/Workspace behavior, provider registry entries, platform behavior that has a safe controller swap, and reload policy. These activate atomically for later messages.
- `RESTART_REQUIRED`: server bind/port/TLS, database location/driver, plugin loading roots, and any component without a safe swap contract.
- `REJECTED`: invalid or unsupported changes.

When a candidate mixes live and restart-bound fields, the persisted document becomes desired state, live-safe fields publish in one new snapshot, and restart-bound active fields retain their previous values. `ConfigState` exposes the desired revision, active snapshot version, exact pending-restart paths, and last activation result. There is never a response claiming the whole desired document is active when it is not.

Old provider/platform/MCP resources remain alive until in-flight snapshots release them, then close asynchronously. This preserves message isolation without leaking resources.

### 7. Use safe persistence and preserve the last known-good state

Writes use a temporary file in the target directory, flush, optional backup of the previous valid document, and atomic move. Optimistic concurrency uses an expected raw revision to prevent Dashboard edits from overwriting external changes.

A missing or whitespace-only file may be initialized only during explicit first-run bootstrap. Malformed, unknown-field, or semantically invalid content is never overwritten with defaults during startup, watcher reload, or API reload. It produces diagnostics and leaves the last known-good snapshot active. Backups are restored by running the same compile/validate/activate path.

File watching debounces changes and waits for a stable file observation before compilation. It cannot invoke a different loading path.

### 8. Expose separate authoring and runtime views

Dashboard uses command/query DTOs rather than serializing internal source or effective types directly:

- raw global and Workspace documents, redacted and revisioned;
- effective snapshot summaries with field-level provenance;
- validation/preview results with diagnostics and activation plan;
- explicit apply, reload, restore, and Workspace reload commands;
- desired-versus-active status and pending restart fields.

Agent chat and sub-agent route tests require a Workspace id and create the same pinned message execution context as a platform message. They cannot read or mutate a separate global orchestration config.

The legacy `GET/PUT /api/config` contract remains temporarily as a deprecated compatibility view but cannot include effective secrets or imply that environment overrides are persisted. New code uses the split endpoints.

### 9. Standardize configuration source selection at process entry

The global config path resolves once using: explicit command-line `--config`, then `PRIESTESS_CONFIG_PATH`, then a documented default path. The JVM property is retained only during migration and reports a deprecation diagnostic. The process logs and health/config status expose the normalized absolute path, which selector chose it, document revision, active snapshot version, and pending restart status.

All Gradle, shell, test, and container launchers pass the intended config path explicitly. Tests may use temporary paths but use the production compiler.

## Risks / Trade-offs

- **Large migration surface:** Configuration touches most controllers. Mitigation: introduce source/effective types alongside legacy types, add compatibility adapters, then migrate consumers one subsystem at a time.
- **Strict decoding breaks previously ignored fields:** This is intentional but can surprise operators. Mitigation: provide a dry-run migration/validation report with exact source path, field path, severity, and suggested replacement.
- **Desired and active state are more explicit but more complex:** The complexity already exists for restart-bound fields. A single `ConfigState` response and activation plan make it observable instead of implicit.
- **Snapshot resource retention can temporarily duplicate providers/MCP sessions:** Reference-count snapshot resources and close superseded generations after in-flight work drains.
- **Tool intersection may reduce capabilities after migration:** Diagnostics list every removed or unknown tool and its policy source before activation.
- **No arbitrary message directory override reduces ad-hoc testing flexibility:** Register temporary test Workspaces explicitly; this preserves auditability and path safety.

## Migration Plan

1. Add versioned v2 source/effective models, diagnostics, strict decoders, compiler, provenance, and snapshot store without changing existing consumers.
2. Add a read-only legacy adapter and migration command that converts current `PriestessConfig` plus Workspace YAML into candidate v2 documents. It reports conflicts such as duplicated Agents, provider mismatch, unknown tools, and unused fields; it does not overwrite files.
3. Add raw/effective/preview APIs and show source path, provenance, desired/active versions, and restart requirements. Keep legacy endpoints deprecated.
4. Migrate provider, Workspace, Agent, tool, pipeline, platform, server, database, and plugin consumers to effective feature views. Remove direct raw-config and environment reads from those modules.
5. Switch Agent and sub-agent execution to Workspace-owned definitions and enforce compiled tool sets. Make Dashboard tests use the same pipeline entry and pinned snapshot.
6. Standardize launchers and containers on explicit config paths. Add startup validation and last-known-good reload behavior.
7. Run the migration tool, review diagnostics, and explicitly apply v2 files. Keep timestamped backups and a runtime flag to boot the legacy adapter for one release.
8. Remove the legacy adapter, implicit provider/Agent fallbacks, old global Agent/sub-agent fields, and deprecated endpoints after the compatibility window.

Rollback before step 8 selects the backed-up v1 files and legacy adapter. After step 8, rollback requires restoring the prior binary and its backed-up config files.

## Open Questions

- Which existing platform adapters can safely hot-swap credentials or connection settings, and which must initially be classified as restart-required?
- Should optional MCP server failures remain warning-level in production, or should deployments be able to promote selected diagnostic codes to errors?
