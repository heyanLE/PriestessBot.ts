## ADDED Requirements

### Requirement: Typed executable route graph
The system SHALL persist versioned nodes and edges with typed ports and a server-owned node registry. The first release SHALL reject graph cycles and implicit parallel fan-out.

#### Scenario: Invalid edge
- **WHEN** an edge connects incompatible ports or introduces a cycle
- **THEN** publication SHALL fail with node-specific diagnostics.

### Requirement: Agent destination and explicit terminals
Every accepted conversational path SHALL reach exactly one configured Agent destination. Handled commands, denial, rate limiting and ignored inputs SHALL use explicit terminal nodes.

#### Scenario: Normal branch without an Agent
- **WHEN** a conversational branch ends without an Agent destination
- **THEN** graph validation SHALL fail.

#### Scenario: Command handled
- **WHEN** a Command node handles the request and leads to Reply and End
- **THEN** no additional Agent call SHALL be required.

### Requirement: Route node catalog
The system SHALL provide input, condition/switch, transform, runtime-state, rate-limit/deduplication, command, memory recall, knowledge retrieval, Agent, reply, end and error nodes.

#### Scenario: Transform preserves identity
- **WHEN** a transform changes input text
- **THEN** trusted platform, sender and session identity SHALL remain unchanged.

### Requirement: Atomic graph publication
Graph publication SHALL validate references and ports, use optimistic revision checks and atomically publish an immutable execution plan.

#### Scenario: Publish during execution
- **WHEN** a new graph revision is published
- **THEN** existing runs SHALL finish against their original revision and later runs SHALL use the new one.

### Requirement: Bounded observable execution
Every graph run SHALL enforce node and total deadlines, step and payload limits, record node transitions and avoid automatic retries of non-idempotent effects.

#### Scenario: Budget exhausted
- **WHEN** execution exceeds its configured budget
- **THEN** it SHALL terminate through a bounded error path and record the failing node.

### Requirement: Visual authoring and simulation
The Dashboard SHALL support node placement, connections, configuration, undo/redo, drafts, validation, simulation, publication, rollback and run-path inspection.

#### Scenario: Simulate a privileged branch
- **WHEN** an operator supplies a sample event in simulation
- **THEN** the path, selected state and destination Agent SHALL be shown without real model calls or side effects unless live execution is explicitly selected.
