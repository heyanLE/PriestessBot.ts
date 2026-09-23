## 1. Baseline and Compatibility Fixtures

- [x] 1.1 Add sanitized golden fixtures for the current root config, smoke-test config, and Workspace directory config so migration behavior is testable without secrets
- [x] 1.2 Add characterization tests for current config-path selection, environment overrides, Dashboard save/reload, Workspace selection, provider fallback, and Agent/tool field mapping
- [x] 1.3 Create a machine-readable legacy field inventory that maps every current global JSON, Workspace YAML, environment, JVM, launcher, and message metadata field to its v2 owner or removal diagnostic

## 2. Versioned Source and Effective Models

- [x] 2.1 Add `config/model` source data classes for `AppConfigDocument` v2, runtime settings, platforms, provider connections, credential references, and the Workspace catalog
- [x] 2.2 Add source data classes for `WorkspaceConfigDocument` v2, Agents, orchestration, generation, context, execution, tool policy, skills, MCP, personas, and memory
- [x] 2.3 Add distinct `RawConfigState`, `DesiredConfig`, `EffectiveRuntimeSnapshot`, `EffectiveWorkspaceSnapshot`, and feature-specific effective view types
- [x] 2.4 Add configuration diagnostic, provenance, source fingerprint, raw revision, effective version, activation plan, and pending-restart models
- [x] 2.5 Add unit tests proving raw source models cannot contain resolved environment secrets and effective/API serializers redact guarded values

## 3. Sources, Strict Decoding, and Persistence

- [x] 3.1 Implement one config-path selector with command-line, `PRIESTESS_CONFIG_PATH`, migration-only JVM property, and default precedence plus normalized source reporting
- [x] 3.2 Implement strict version-aware JSON decoding for global documents with BOM handling, unknown-field rejection, and source-location diagnostics
- [x] 3.3 Implement strict version-aware YAML and MCP declaration decoding for Workspace directories with unknown-field and duplicate-key rejection
- [x] 3.4 Implement an allowlisted typed `EnvironmentOverrideSource` and `env:` credential resolver without mutating source documents
- [x] 3.5 Implement revisioned atomic source persistence using a same-directory temporary file, flush, valid backup, atomic move, and expected-revision conflict detection
- [x] 3.6 Replace malformed/empty passive reload behavior with diagnostics and last-known-good preservation; add an explicit first-run bootstrap command for default creation
- [x] 3.7 Implement a debounced stable-observation file watcher that calls the production compiler and add editor truncate/replace regression tests

## 4. Validation, Resolution, and Provenance

- [x] 4.1 Implement structural and value validators for schema version, identifiers, uniqueness, ranges, path safety, and wrong-owner fields
- [x] 4.2 Implement cross-document validators for Workspace catalog, provider, Agent, route, persona, skill, MCP, and tool references with no implicit fallback
- [x] 4.3 Implement deterministic Workspace selection by explicit id, catalog rules, platform default, and global default with provenance and ambiguity validation
- [x] 4.4 Implement typed default resolution without shallow map merging and add nested-default regression tests
- [x] 4.5 Implement Workspace runtime resource resolution for skills, required/optional MCP servers, MCP tools, personas, and registered tools
- [x] 4.6 Implement Workspace, Agent, risk-level, sender-permission, and runtime-availability tool intersection with contradiction and unknown-tool diagnostics
- [x] 4.7 Implement field-level non-secret provenance and source fingerprints for global, environment, Workspace, defaulted, and selected values
- [x] 4.8 Implement `ConfigurationCompiler` as the single startup, preview, apply, global reload, and Workspace reload pipeline and add deterministic compilation tests

## 5. Snapshot Storage and Activation

- [x] 5.1 Implement a thread-safe `EffectiveConfigStore` that atomically publishes monotonically versioned immutable runtime and Workspace snapshots
- [x] 5.2 Implement diff classification for live, restart-required, and rejected paths with initial conservative platform hot-swap classifications
- [x] 5.3 Implement `ConfigActivationCoordinator` with desired-versus-active state, pending restart reporting, and all-or-nothing live publication
- [x] 5.4 Implement snapshot resource leases so superseded provider, platform, and MCP resources close only after in-flight snapshots release them
- [x] 5.5 Add concurrency tests proving readers never observe partial candidates and in-flight messages retain their pinned generations
- [x] 5.6 Route explicit reload, watched reload, restore, and persisted apply through compilation and activation; verify failed candidates preserve the last known-good snapshot

## 6. Runtime Consumer Migration

- [x] 6.1 Refactor `ConfigCase` into a narrow source/status command façade and remove direct raw `PriestessConfig` consumption from runtime feature modules
- [x] 6.2 Migrate provider creation and lookup to effective provider connections and explicit Agent model selection; remove first-provider and provider-default-model fallback
- [x] 6.3 Migrate `WorkspaceController` to catalog-owned directories, compiled active snapshots, explicit reload, and resolved MCP tools
- [x] 6.4 Migrate `PrepareWorkspaceStage` to pin coherent runtime and Workspace snapshots and remove per-message source-file reads and arbitrary directory overrides
- [x] 6.5 Migrate pipeline stages and metadata to use only pinned effective feature views and record non-secret configuration trace information
- [x] 6.6 Migrate `AgentController` and `ReActRunner` to apply effective provider, model, temperature, token limits, compression, max steps, tool timeout, persona, memory, and tool set fields
- [x] 6.7 Migrate `ToolExecutor` and LLM prompt construction to share the same permission-narrowed effective tool registry
- [x] 6.8 Migrate sub-agent routing to Workspace-owned Agents and validated explicit fallback, and make Dashboard and platform execution use the common runner path
- [x] 6.9 Migrate platform, server, database, plugin, permission, and command consumers to effective views and expose restart-bound behavior accurately

## 7. Dashboard Configuration API

- [x] 7.1 Add redacted revisioned raw global and raw Workspace query endpoints with normalized source and schema metadata
- [x] 7.2 Add effective configuration and Workspace status endpoints with active version, desired revision, provenance, diagnostics, and pending restart paths
- [x] 7.3 Add side-effect-free global and Workspace preview endpoints that return effective diffs and activation plans
- [x] 7.4 Add optimistic-concurrency apply endpoints that recompile, persist atomically, coordinate activation, and return desired-versus-active status
- [x] 7.5 Update reload, backup restore, health, Workspace reload, Agent chat, and sub-agent test endpoints to use the compiler and pinned runtime path
- [x] 7.6 Add deprecated redacted compatibility behavior for `GET/PUT /api/config` without serializing internal or environment-resolved secret values
- [x] 7.7 Add API tests for redaction, unknown fields, revision conflicts, invalid reference diagnostics, preview side-effect isolation, activation status, and platform/Dashboard equivalence

## 8. Legacy Migration and Deployment Entry Points

- [x] 8.1 Implement a read-only v1 adapter that parses current `PriestessConfig` and Workspace files without using them as v2 runtime types
- [x] 8.2 Implement a dry-run migration command that proposes v2 global and Workspace documents and reports duplicate ownership, provider mismatch, ignored fields, unknown tools, and plaintext secrets
- [x] 8.3 Add golden migration tests for root, smoke-test, container, missing-field, invalid-tool, duplicate-Agent, and environment-override cases
- [x] 8.4 Update Gradle run configuration, `run-server.sh`, black-box scripts, tests, and container entry points to pass an explicit config path through the common selector
- [x] 8.5 Add startup and health logging for path selector, normalized path, raw revision, active snapshot version, Workspace versions, diagnostics summary, and pending restart count
- [x] 8.6 Add a one-release legacy boot flag and documented removal diagnostics without automatically overwriting v1 files

## 9. Verification and Legacy Removal

- [x] 9.1 Add end-to-end tests proving direct startup, smoke launcher, Dashboard chat, sub-agent test, and platform message produce the same effective Workspace, Agent, provider, model, and tools
- [x] 9.2 Add reload tests for valid live changes, mixed live/restart changes, malformed files, unknown fields, missing references, MCP failures, and concurrent edits
- [x] 9.3 Add security tests proving message metadata cannot read unregistered directories and raw/effective/provenance/log/API responses never expose resolved secrets
- [x] 9.4 Run the migration dry-run against all repository-owned configuration fixtures and resolve every error-level diagnostic before enabling v2 by default
- [x] 9.5 Remove legacy global Agent/sub-agent fields, shallow Workspace merge, unused Workspace rule/MCP paths, implicit fallbacks, and direct environment reads after the compatibility window
- [x] 9.6 Remove the legacy boot adapter and deprecated config replacement endpoint after migration acceptance, then run the complete unit, integration, Dashboard, and launcher smoke suites
