## ADDED Requirements

### Requirement: Each Agent type declares its engine and capabilities

The runtime SHALL register every `AgentType` with a nonempty LLM protocol set, a tool-injection mode set, an engine, an internal preset only for internal engines, and default budgets. An unavailable type SHALL fail activation with an explicit diagnostic.

#### Scenario: Existing internal Agent
- **WHEN** a v3 Agent selects `NORMAL` or `DEEPSEEK_HARNESS`
- **THEN** it uses the same internal preset and runner as before the type migration

#### Scenario: External type is not installed
- **WHEN** a CODEX Agent is enabled before its external runner is registered
- **THEN** configuration activation is rejected rather than falling back to ReAct

### Requirement: External engine turns do not require ChatProvider

The pipeline SHALL resolve the effective provider connection before engine dispatch. For an internal type it SHALL construct a `ChatProvider`; for an external type it SHALL invoke the registered external runner with that connection and current caller context.

#### Scenario: External runner is present
- **WHEN** an external Agent turn reaches ProcessStage with a registered runner
- **THEN** the runner receives the effective provider and exact current user input
- **AND** its `AgentResponse` is passed to the normal response pipeline

### Requirement: The type roster is server-owned

The Dashboard SHALL obtain type names, protocol and injection capabilities, availability and defaults from the server. It SHALL preserve an existing unknown value for editing without silently replacing it.
