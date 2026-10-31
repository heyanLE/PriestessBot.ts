## ADDED Requirements

### Requirement: Owned execution environments
Execution sessions, files and artifacts SHALL be scoped to their authorized Agent/session/run. PTY, stdin, patch, output and cancellation SHALL share the same authorization checks.

#### Scenario: Foreign process access
- **WHEN** another session attempts to list, read, write or kill a process it does not own
- **THEN** access SHALL be denied regardless of knowledge of its identifier.

### Requirement: Scheduled background completion delivery
Background completion SHALL enter the session scheduler with original provenance and idempotent completion identity.

#### Scenario: Duplicate completion event
- **WHEN** the same background process completion is delivered twice
- **THEN** at most one continuation SHALL be scheduled.

### Requirement: Scoped durable long-term memory
Memory SHALL preserve source, scope, timestamps and deletion state, enforce Agent library selection and runtime-state capabilities, and support extraction, recall and consolidation through one authoritative lifecycle.

#### Scenario: Group facts promoted automatically
- **WHEN** consolidation processes mixed-sender group conversation
- **THEN** private facts SHALL NOT be automatically promoted into global shared memory.

#### Scenario: Delete a memory
- **WHEN** an authorized deletion succeeds
- **THEN** subsequent recall SHALL exclude the record and derived retrieval caches SHALL be invalidated.

### Requirement: Hybrid knowledge retrieval
Knowledge ingestion SHALL track document versions, parsing/chunking/indexing status and provenance, and SHALL support sparse/vector fusion with optional reranking and access filtering.

#### Scenario: Restricted library
- **WHEN** a query runs without access to a knowledge library
- **THEN** neither chunks nor citations from that library SHALL appear.

#### Scenario: Failed ingestion
- **WHEN** indexing a document fails
- **THEN** the import SHALL expose a retryable failure state and SHALL NOT publish a partially indexed version as complete.

### Requirement: Bounded active delegation
Agents SHALL be able to invoke explicitly assigned child Agents with isolated context and bounded depth, concurrency, time and token budgets.

#### Scenario: Parent cancelled
- **WHEN** a parent run is cancelled
- **THEN** cancellation SHALL propagate to all active descendants and prevent new descendant tool effects.

#### Scenario: Child completes
- **WHEN** a child finishes its delegated task
- **THEN** the parent SHALL receive a provenance-labelled result without an implicit independent IM reply.
