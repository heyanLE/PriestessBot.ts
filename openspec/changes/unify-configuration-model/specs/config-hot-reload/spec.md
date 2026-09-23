## MODIFIED Requirements

### Requirement: Explicit config reload
The system SHALL reload configuration through the same strict compile, validation, activation-planning, and atomic-publication path used at startup and by Dashboard apply.

#### Scenario: Reload from disk succeeds
- **WHEN** `POST /api/config/reload` is called for a valid changed source revision
- **THEN** the system compiles the configured global file and its registered Workspaces
- **AND** atomically publishes live-applicable changes as one new effective snapshot
- **AND** returns desired revision, active snapshot version, diagnostics, and pending restart fields

#### Scenario: Config reload does not implicitly reload unchanged Workspaces
- **WHEN** the global Workspace catalog is reloaded
- **THEN** unchanged Workspace source fingerprints reuse their active immutable snapshots
- **AND** changed Workspace sources are compiled before the candidate can activate

#### Scenario: Invalid reload preserves active state
- **GIVEN** an active snapshot exists
- **WHEN** explicit reload compilation fails
- **THEN** the existing snapshot remains active
- **AND** the endpoint returns structured diagnostics without publishing partial config flows

### Requirement: Config write publication
The system SHALL validate and preview a revisioned raw configuration replacement before persistence and SHALL publish it only through activation coordination.

#### Scenario: API config replacement
- **WHEN** a Dashboard apply command supplies a valid raw document and the current expected revision
- **THEN** the document is persisted atomically
- **AND** live-applicable changes publish as one effective snapshot
- **AND** restart-bound changes are reported as desired but pending

#### Scenario: API config replacement conflicts
- **WHEN** a Dashboard apply command supplies a stale expected revision
- **THEN** the write and activation are rejected
- **AND** the active snapshot and newer source document remain unchanged

### Requirement: Runtime config publication
The system SHALL publish one immutable effective runtime snapshot after explicit updates or reloads rather than publishing independently timed mutable config slices.

#### Scenario: Provider controller observes activated provider registry
- **GIVEN** a valid live provider change has activated as snapshot version `N+1`
- **WHEN** a later Agent execution requests a provider
- **THEN** it resolves the provider from its pinned snapshot version `N+1`
- **AND** it does not read raw config or environment variables

#### Scenario: Pipeline observes activated config for subsequent messages
- **GIVEN** a valid Agent, pipeline, or orchestration change has activated
- **WHEN** the next message enters the pipeline
- **THEN** it pins the latest effective runtime and Workspace snapshots
- **AND** every stage uses those pinned snapshots without requiring process restart

#### Scenario: Workspace catalog change applies to later messages
- **GIVEN** a valid catalog or default Workspace id change has activated
- **WHEN** a later message enters Workspace preparation
- **THEN** the runtime uses the catalog from the latest pinned effective snapshot
- **AND** in-flight messages retain their prior selection and snapshot

#### Scenario: Restart-bound field remains pending
- **GIVEN** a valid candidate changes a restart-bound server, database, or plugin field
- **WHEN** the candidate is applied
- **THEN** no live controller claims the new field is active
- **AND** status reports its desired value and restart requirement

### Requirement: Configuration files SHALL load robustly from disk
The runtime SHALL load configuration from disk without treating supported first-run or editor encoding artifacts as malformed config and without destroying invalid operator input.

#### Scenario: UTF-8 BOM config is accepted
- **GIVEN** a config file starts with a UTF-8 byte order mark followed by valid JSON
- **WHEN** the configuration source is loaded or reloaded
- **THEN** it SHALL decode the JSON config successfully
- **AND** it SHALL NOT replace the file because of the byte order mark

#### Scenario: Empty config file requires explicit bootstrap
- **GIVEN** a config path exists but contains only empty or whitespace text
- **WHEN** normal startup or reload reads the file
- **THEN** compilation fails with an empty-document diagnostic
- **AND** the file and last known-good active snapshot remain unchanged
- **AND** only an explicit first-run bootstrap command may persist defaults to that path

#### Scenario: Malformed config is preserved
- **GIVEN** a config file contains non-empty malformed JSON
- **WHEN** the configuration source is loaded or reloaded
- **THEN** the malformed file remains unchanged
- **AND** the last known-good active snapshot remains active
- **AND** diagnostics identify the source and parse location without replacing content with defaults

## ADDED Requirements

### Requirement: File watcher uses stable candidate compilation
The optional file watcher SHALL debounce source events, wait for a stable observation, and invoke the production configuration compiler.

#### Scenario: Editor temporary write does not reset configuration
- **GIVEN** an editor temporarily truncates and then atomically replaces a watched config file
- **WHEN** watcher events occur
- **THEN** the watcher waits for its stability window before compilation
- **AND** no default configuration is published during the temporary state

#### Scenario: Watched candidate is invalid
- **GIVEN** a stable watched source revision is invalid
- **WHEN** watcher compilation finishes
- **THEN** the active snapshot remains unchanged
- **AND** the failed revision and diagnostics are visible in configuration status
