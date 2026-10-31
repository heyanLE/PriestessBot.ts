## ADDED Requirements

### Requirement: Native Rust engine and code mode
The service SHALL integrate a pinned public Rust Engine API and matching code-mode-host, exposing authorized dynamic tools through code mode with structured results.

#### Scenario: Deferred dynamic tool call
- **WHEN** the model invokes an authorized tool through code mode
- **THEN** the host SHALL execute it under the current run context and return typed text, image or artifact content.

### Requirement: Per-turn authorization
Tool callbacks SHALL be bound to originating run, turn and call IDs and SHALL enforce permissions at execution time.

#### Scenario: Late callback
- **WHEN** a previous turn issues a callback after another caller starts
- **THEN** it SHALL be rejected without executing under the new caller.

### Requirement: Stateful bounded conversation scheduling
Each IM-instance/session/Agent key SHALL have at most one active turn with bounded queued work. Independent sessions SHALL run concurrently within global limits.

#### Scenario: Compatible follow-up
- **WHEN** the same sender sends a follow-up with the same Agent, effective state, authorization and compatible graph context
- **THEN** it SHALL be eligible for steering into the running turn.

#### Scenario: State changes between messages
- **WHEN** the same sender's next message selects a different runtime state
- **THEN** it SHALL NOT steer into the prior turn and SHALL execute as a separately authorized turn.

#### Scenario: Queue full
- **WHEN** a session queue reaches its configured limit
- **THEN** additional input SHALL receive an explicit busy outcome without silently replacing accepted input.

### Requirement: Dynamic context preserves thread continuity
Retrieved memories, knowledge and other per-turn context SHALL be passed separately from stable engine configuration and SHALL NOT independently force thread replacement.

#### Scenario: Different memory recall
- **WHEN** a later message retrieves different memories
- **THEN** the existing compatible thread SHALL continue with the updated context.

### Requirement: Image file and stream preservation
Text, image and file inputs and tool outputs SHALL preserve their content types and provenance across the model boundary. The runtime SHALL expose ordered streaming events and a terminal outcome.

#### Scenario: Image input
- **WHEN** a platform supplies an authorized supported image
- **THEN** the model SHALL receive image content rather than only a textual placeholder.

#### Scenario: Cancellation during streaming
- **WHEN** a streaming turn is cancelled
- **THEN** emitted text SHALL remain traceable and the turn SHALL finish with a cancelled outcome without duplicate final delivery.

### Requirement: Recovery and shutdown
Thread mappings and rollouts SHALL be persisted; restart SHALL resume compatible threads. Shutdown SHALL cancel or drain active turns, child tasks and event streams.

#### Scenario: Resume fails
- **WHEN** a stored thread cannot be resumed
- **THEN** the continuity reset SHALL be reported explicitly and historical records SHALL remain available.
