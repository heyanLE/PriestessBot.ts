# sub-agent-orchestration Specification

## Purpose
TBD - created by archiving change sub-agent-routing-foundation. Update Purpose after archive.

> TypeScript requirements apply to runtime `priestess-ts`. Unmodified Kotlin/workspace-specific requirements below remain reference requirements for the legacy runtime.

## Requirements

### Requirement: Sub-agent routing config
The system SHALL configure explicit delegation target bindings on independent Agents and route top-level messages through the single built-in flow.

#### Scenario: Default config is backward-compatible
- **WHEN** an Agent omits delegation bindings
- **THEN** it SHALL remain usable without delegated execution

#### Scenario: Agent provides target scope
- **WHEN** an Agent selects delegation targets
- **THEN** only enabled permitted targets SHALL be exposed to that Agent

### Requirement: Keyword route selection
Top-level Agent selection SHALL evaluate deterministic node rules, including configured text conditions, and a valid default or explicit terminal outcome.

#### Scenario: Keyword rule matches
- **WHEN** a configured text condition matches
- **THEN** the fixed flow SHALL select the referenced Agent

#### Scenario: No rule matches
- **WHEN** no selection rule matches
- **THEN** the configured default Agent or explicit ignore/reject outcome SHALL apply

### Requirement: Routed Agent execution
The selected Agent SHALL execute through the common typed engine interface using its pinned configuration and effective turn authorization.

#### Scenario: Selected Agent returns final response
- **WHEN** a selected Agent completes
- **THEN** the result SHALL identify that Agent and its typed response content

#### Scenario: Selected Agent uses its resources
- **WHEN** a message selects an Agent
- **THEN** provider, persona, libraries and budgets SHALL come from that Agent's valid configuration revision

### Requirement: Sub-agent route selection
Agent selection SHALL remain deterministic within the fixed flow and distinct from an Agent actively delegating a child task.

#### Scenario: Pipeline uses selected Agent
- **WHEN** an accepted normal message resolves a target Agent
- **THEN** exactly that top-level Agent SHALL run with trusted sender/state context

### Requirement: Active delegation lifecycle
An Agent SHALL be able to invoke an explicitly bound target with a bounded task context. Child runs SHALL use independent engine sessions, inherit parent permission ceilings, obey depth/count/concurrency and shared budgets, and propagate parent cancellation.

#### Scenario: Child result returns to parent
- **WHEN** a delegated task completes
- **THEN** its result SHALL return to the parent as a source-labeled tool result without an unsolicited separate IM reply

#### Scenario: Parent cancellation
- **WHEN** a parent run is cancelled
- **THEN** owned child runs SHALL be cancelled and SHALL not perform later effects or replies

#### Scenario: Scheduler deadlock prevention
- **WHEN** a parent awaits a child
- **THEN** child scheduling SHALL not depend on a conversation lock or concurrency slot permanently held by that waiting parent
