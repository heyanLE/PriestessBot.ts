## ADDED Requirements

### Requirement: Configuration fields have one authoritative owner
The system SHALL assign every supported configuration field to exactly one source model and SHALL reject a field that appears in a source that does not own it.

#### Scenario: Workspace owns Agent behavior
- **GIVEN** a Workspace document defines Agents, sub-agents, routing, tool policy, skills, MCP, personas, or memory
- **WHEN** the configuration candidate is compiled
- **THEN** those values are resolved from that Workspace document
- **AND** no global Agent or orchestration value overrides them

#### Scenario: Wrong-layer field is rejected
- **GIVEN** a global app document contains an Agent behavior field or a Workspace document contains a server or database field
- **WHEN** the document is compiled
- **THEN** compilation fails with a diagnostic containing the source and field path
- **AND** the field is not silently ignored

### Requirement: Configuration sources use deterministic precedence
The system SHALL use one deterministic source-selection model for global configuration, environment overrides, Workspace selection, and effective runtime compilation.

#### Scenario: Global config path is resolved once
- **GIVEN** command-line, environment, JVM-property, and default config paths may be present
- **WHEN** the process starts
- **THEN** it selects command-line `--config`, then `PRIESTESS_CONFIG_PATH`, then the migration-only JVM property, then the default path
- **AND** it reports the normalized absolute path and selector used

#### Scenario: Message selects a registered Workspace
- **GIVEN** a message supplies a Workspace id that exists and is enabled in the global Workspace catalog
- **WHEN** the message enters the pipeline
- **THEN** that registered Workspace is selected
- **AND** message metadata cannot replace its directory or behavior fields

#### Scenario: Workspace selection falls back deterministically
- **GIVEN** no valid explicit Workspace id is supplied by the message
- **WHEN** Workspace selection runs
- **THEN** it evaluates catalog selection rules, then the platform default Workspace id, then the global default Workspace id
- **AND** records the winning rule as provenance

### Requirement: Source documents are versioned and strictly decoded
The system SHALL decode global and Workspace source documents by schema version, reject unknown or duplicate fields and identifiers, and migrate only through explicit schema transformations.

#### Scenario: Unknown field is reported
- **GIVEN** a source document contains a field not defined by its schema version
- **WHEN** it is decoded
- **THEN** compilation fails with a diagnostic naming the document and field path

#### Scenario: Older known schema is migrated in memory
- **GIVEN** a source document has a supported older schema version
- **WHEN** it is compiled
- **THEN** an explicit migration transforms it to the current source model
- **AND** the original file is not overwritten without an explicit apply command

#### Scenario: Duplicate identifiers are rejected
- **GIVEN** a document contains duplicate provider, platform, Workspace, Agent, route, persona, skill, MCP server, or tool policy identifiers
- **WHEN** semantic validation runs
- **THEN** compilation fails with diagnostics for every duplicate identifier

### Requirement: Persisted, desired, and effective configuration are distinct types
The system SHALL represent persisted source documents, environment-resolved desired configuration, and active effective configuration as distinct data types that cannot be serialized interchangeably.

#### Scenario: Environment override is not persisted
- **GIVEN** an environment override or secret reference changes an effective runtime value
- **WHEN** the raw configuration is saved through the Dashboard or backup flow
- **THEN** the environment-derived value is absent from the persisted source document
- **AND** the original reference remains unchanged

#### Scenario: Desired and active states differ for restart-bound fields
- **GIVEN** a valid candidate changes a restart-required field
- **WHEN** the candidate is applied without restarting the process
- **THEN** the desired revision contains the new value
- **AND** the active snapshot retains the old value
- **AND** configuration status lists the exact pending-restart field path

### Requirement: Configuration compilation validates all runtime references
The system SHALL validate required provider, Workspace, Agent, route, persona, skill, MCP, and tool references before an effective snapshot is published.

#### Scenario: Missing provider fails compilation
- **GIVEN** an Agent references a provider id that does not exist or is disabled
- **WHEN** its Workspace candidate is compiled
- **THEN** compilation fails with a diagnostic naming the Agent and provider id
- **AND** the runtime does not substitute the first provider

#### Scenario: Unknown tool fails compilation
- **GIVEN** a Workspace or Agent tool policy names a tool that is neither registered nor supplied by a compiled MCP server
- **WHEN** its Workspace candidate is compiled
- **THEN** compilation fails with a diagnostic naming the policy path and tool id
- **AND** the unknown entry does not disappear silently

#### Scenario: Invalid route target fails compilation
- **GIVEN** an orchestration route or default Agent references an unknown or disabled Agent
- **WHEN** the Workspace candidate is compiled
- **THEN** the candidate is rejected before activation

### Requirement: Effective snapshots include non-secret provenance
The system SHALL attach field-level source provenance, source fingerprints, diagnostics, and a monotonically increasing version to each immutable effective runtime snapshot.

#### Scenario: Operator inspects effective value origin
- **GIVEN** an active effective snapshot
- **WHEN** an operator inspects a non-secret field
- **THEN** the system reports its value, owning source kind, source location, source revision, and effective snapshot version

#### Scenario: Secret provenance is redacted
- **GIVEN** a provider credential is resolved from an environment variable
- **WHEN** provenance or effective configuration is serialized
- **THEN** it may report the credential source type and variable name
- **AND** it never reports the resolved secret value

### Requirement: Effective Agent tools are compiled as an intersection
The system SHALL advertise and execute only tools present in runtime availability, Workspace policy, Agent policy, and sender permission policy.

#### Scenario: Narrower Agent policy removes a Workspace tool
- **GIVEN** a Workspace allows tools `read` and `write`
- **AND** an Agent allows only `read`
- **WHEN** that Agent's effective tool set is compiled
- **THEN** only `read` is advertised to the model before sender permissions are applied

#### Scenario: Permission policy narrows the executable set
- **GIVEN** a compiled Agent tool set includes a high-risk tool
- **AND** the resolved sender permission does not allow its risk level
- **WHEN** the Agent context is created
- **THEN** the high-risk tool is absent from both the model tool definitions and executable ToolExecutor set

### Requirement: Configuration activation is atomic and versioned
The system SHALL publish a complete immutable effective snapshot only after compilation succeeds and SHALL preserve the last known-good snapshot when a candidate fails.

#### Scenario: Successful live candidate activates atomically
- **GIVEN** a valid candidate contains only live-applicable changes
- **WHEN** activation completes
- **THEN** later messages observe one new snapshot version containing all candidate changes
- **AND** no message observes a partially updated set of feature configs

#### Scenario: Invalid candidate preserves active state
- **GIVEN** an active snapshot version `N`
- **WHEN** syntax, semantic, reference, or resource validation fails for a candidate
- **THEN** version `N` remains active
- **AND** the failure diagnostics and attempted source revision are recorded

### Requirement: Configuration persistence is atomic and concurrency-safe
The system SHALL write source documents atomically and SHALL require the expected raw revision for persisted replacements.

#### Scenario: Concurrent edit is detected
- **GIVEN** a Dashboard client read raw revision `R`
- **AND** the source file changed to revision `R+1`
- **WHEN** the client attempts to apply an edit with expected revision `R`
- **THEN** persistence is rejected as a revision conflict
- **AND** revision `R+1` is not overwritten

#### Scenario: Persisted replacement is atomic
- **GIVEN** a validated source document is approved for persistence
- **WHEN** it is written
- **THEN** the system writes and flushes a temporary file in the target directory
- **AND** atomically moves it over the target after any configured valid backup is created
