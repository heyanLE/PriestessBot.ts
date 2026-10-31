## ADDED Requirements

### Requirement: Strict TypeScript delivery boundary
All first-party production runtime, frontend scripts and production tooling SHALL use strictly checked TypeScript. CI MUST reject explicit or implicit any, unsafe operations or assertions, production type-check suppression, and unchecked JavaScript entry points.

#### Scenario: Unsafe boundary implementation
- **WHEN** a production change casts parsed JSON directly to a domain type or introduces any
- **THEN** type/lint checks SHALL fail before release

#### Scenario: External data validation
- **WHEN** an external payload enters as unknown
- **THEN** a runtime schema SHALL validate it before domain access and malformed data SHALL produce a typed failure

### Requirement: Shared schemas and exhaustive domain contracts
Backend and Dashboard SHALL share validated contracts for configuration, commands, node parameters, events and errors. Domain identifiers SHALL remain distinct types and variant handling MUST be exhaustive.

#### Scenario: New event variant
- **WHEN** a new event kind is added without updating a required consumer
- **THEN** compilation SHALL identify the incomplete handling

### Requirement: Independent Agent and engine identity
The runtime SHALL preserve Agent identity, engine/model selection, persona, resource bindings, directories and budgets independently from a turn's runtime state.

#### Scenario: Same Agent under different states
- **WHEN** two authorized callers run the same Agent at different runtime states
- **THEN** both executions SHALL refer to the same Agent definition with separate effective authorization

#### Scenario: Unsupported migrated engine
- **WHEN** migration encounters an engine not yet implemented in TypeScript
- **THEN** it SHALL report and disable that Agent rather than silently change engines

### Requirement: Revisioned execution and migration qualification
Runs SHALL pin configuration revisions, expose correlated typed events and use explicit runtime/schema identity. Migration MUST support dry-run, backups, independent target storage and per-entity diagnostics.

#### Scenario: Runtime format mismatch
- **WHEN** a Rust or Kotlin document has a numeric schema version matching a TypeScript document
- **THEN** its runtime discriminator and schema SHALL still be validated and an explicit importer SHALL be required

#### Scenario: Deployment cutover
- **WHEN** the new runtime begins consuming an existing IM connection
- **THEN** the previous consumer SHALL be stopped and a recoverable source snapshot SHALL exist
