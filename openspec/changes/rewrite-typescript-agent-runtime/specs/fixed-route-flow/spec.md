## ADDED Requirements

### Requirement: Single built-in routing topology
The first release SHALL provide exactly one system-defined routing flow with fixed node identities, connections and branch semantics. Node parameters SHALL be editable; topology changes, custom flows and executable user scripts MUST be rejected.

#### Scenario: Attempted topology upload
- **WHEN** a client submits added nodes, changed edges or an unknown handler
- **THEN** the backend SHALL reject the configuration without changing the active flow

### Requirement: Typed editable nodes
Built-in nodes SHALL cover input normalization/deduplication, acceptance/rate limits, identity/runtime state, Agent selection, command dispatch, context assembly, Agent execution, delivery and terminal outcomes. Parameters SHALL be validated against server-owned schemas.

#### Scenario: Node references disabled Agent
- **WHEN** an Agent selection node references a disabled or missing Agent
- **THEN** validation SHALL fail and preserve the active revision

#### Scenario: State node requests elevation
- **WHEN** node parameters request a runtime state exceeding the current principal's grant
- **THEN** execution SHALL reject the elevation rather than treat the node as an independent grant

### Requirement: Deterministic Agent termination
Every accepted normal-chat path SHALL resolve and run exactly one top-level Agent. Commands that are handled, rejected or invalid, ignored messages and errors SHALL use explicit terminal paths without redundant model calls.

#### Scenario: Plain chat reaches Agent
- **WHEN** an accepted message is not handled as a command
- **THEN** the chosen Agent SHALL receive validated identity, runtime state and authorized context

#### Scenario: Recognized command completes
- **WHEN** a command returns handled
- **THEN** its reply SHALL reach delivery and no Agent turn SHALL start

### Requirement: Revisioned node configuration and simulation
Node configuration SHALL support drafts, validation, side-effect-free simulation, expected-revision publication and rollback. Active runs SHALL pin their starting revision and obey step/deadline/payload budgets.

#### Scenario: Concurrent configuration edit
- **WHEN** a client publishes against an outdated revision
- **THEN** the server SHALL report a conflict rather than overwrite the latest configuration

#### Scenario: Simulation
- **WHEN** an operator simulates a sample message
- **THEN** the result SHALL show path, runtime state, selected Agent and rejection reasons without executing models, commands or external effects

### Requirement: Visible execution path
The flow view SHALL display the fixed topology, configurable nodes and correlated run results using the existing Dashboard visual language.

#### Scenario: Inspect failed node
- **WHEN** an operator selects a failed node in a recorded run
- **THEN** its bounded input/output summaries, elapsed time and typed error SHALL be visible
