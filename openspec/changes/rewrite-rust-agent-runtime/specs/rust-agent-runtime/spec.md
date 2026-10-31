## ADDED Requirements

### Requirement: Independent Rust Agent runtime
The Rust service SHALL retain independently addressable Agent definitions with model, engine, persona, instructions, skills, memory, knowledge, tools and directory bindings.

#### Scenario: Same Agent under different states
- **WHEN** two routes select the same Agent with different runtime states
- **THEN** the Agent identity SHALL remain the same and each run SHALL carry its own authorized capabilities.

### Requirement: Versioned configuration and migration
The service SHALL validate and atomically publish immutable configurations and SHALL import legacy data into a separate destination with an explicit migration report.

#### Scenario: Unsupported legacy engine
- **WHEN** an imported Agent requires an unavailable engine
- **THEN** it SHALL be disabled with a diagnostic rather than silently assigned to another engine.

#### Scenario: Invalid update
- **WHEN** configuration contains unresolved resources
- **THEN** activation SHALL fail and existing runs SHALL retain their pinned configuration.

### Requirement: Reproducible Rust release
The release SHALL pin the Codex fork and matching code-mode-host and SHALL provide health, tracing and graceful shutdown on each declared supported target.

#### Scenario: Target qualification
- **WHEN** a Linux artifact is declared supported
- **THEN** its engine startup, tool callback, cancellation and restart recovery SHALL have passed on that target.


### Requirement: Durable atomic configuration publication
The persistent runtime SHALL store complete configuration and graph snapshots in SQLite, validate before activation, and atomically advance the active revision using an expected revision check.

#### Scenario: Restart after graph publication
- **WHEN** the process restarts after publishing a graph revision
- **THEN** it SHALL load the same active configuration and graph content, while earlier revisions remain available for rollback.

#### Scenario: Conflicting publication
- **WHEN** two publishers use the same expected active revision
- **THEN** at most one SHALL commit and the other SHALL leave no partially activated snapshot.

### Requirement: Explicit repeatable authoring migration
The importer SHALL support the current Kotlin v3 authoring model and Rust harness/v4 JSON formats, preserve the source in a protected backup at a separate destination, and record a source hash and per-entity diagnostics. Unsupported engines and bindings SHALL NOT be silently activated.

#### Scenario: Repeat import after operator edits
- **WHEN** the same source is imported into its previous destination after a later configuration was published
- **THEN** the importer SHALL report the existing import without replacing those edits.

#### Scenario: Unsupported source version
- **WHEN** a source uses an unsupported legacy schema
- **THEN** migration SHALL fail explicitly rather than reinterpret it as a supported configuration.
