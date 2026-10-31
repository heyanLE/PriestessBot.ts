## ADDED Requirements

### Requirement: Project Agent remains engine independent
The project SHALL own AgentDefinition, stable Agent identity, resource bindings, model configuration and runtime authorization. SDK Agent instances, results and native state types MUST remain internal to the engine adapter and MUST NOT become public API or persistence contracts.

#### Scenario: SDK execution object created
- **WHEN** AgentsSdkEngine constructs an SDK Agent for a run
- **THEN** it SHALL map the authorized project Agent definition without replacing its identity or sharing mutable caller permissions

### Requirement: Agents SDK is the initial engine
The first engine SHALL use a pinned official @openai/agents release through public APIs for the model/tool loop. Codex SDK SHALL remain a future extension and MUST NOT be a first-release runtime dependency or advertised working engine.

#### Scenario: Unsupported engine selected
- **WHEN** configuration requests codex_sdk before its adapter exists
- **THEN** activation SHALL report the unavailable engine rather than silently substitute agents_sdk

### Requirement: Minimal replaceable engine contract
Core services SHALL use typed engine input, events, results, capabilities and opaque versioned session references. A future engine adapter SHALL integrate without changing Agent identity, routing, authorization or Dashboard domain contracts.

#### Scenario: Substitute a contract-test engine
- **WHEN** a test adapter replaces AgentsSdkEngine
- **THEN** the same routing, tool authorization, cancellation and delivery contracts SHALL remain applicable without SDK class dependencies

#### Scenario: Incompatible saved engine state
- **WHEN** a run attempts to restore state belonging to another engine or incompatible version
- **THEN** restoration SHALL fail explicitly while preserving authorized application history

### Requirement: SDK feasibility gate
Before production activation the pinned release SHALL pass strict compilation and tests for typed tools/context, persistent sessions, pause/resume, cancellation, streaming, image input and external MCP integration.

#### Scenario: Declaration dependency fails
- **WHEN** a clean install cannot type-check the SDK integration
- **THEN** the build SHALL fail until dependencies or adapters are corrected without unsafe type suppression

### Requirement: Direct typed tools with trusted context
Local tools SHALL register validated schemas and typed handlers that call the common ToolExecutor with trusted local application context. External MCP tools SHALL use the same authorization boundary. SDK guardrails MUST NOT replace deterministic server authorization.

#### Scenario: Forged privilege arguments
- **WHEN** a tool call supplies another sender or higher runtime state as model arguments
- **THEN** authorization SHALL use trusted RunContext and deny unauthorized effects

#### Scenario: Late tool after reset
- **WHEN** a cancelled or superseded run issues a tool call
- **THEN** the executor SHALL reject it before side effects

### Requirement: Bounded conversation scheduling
The host SHALL serialize turns per business conversation with bounded queues and global concurrency budgets. The initial active-run follow-up behavior SHALL queue messages for a later turn; native steering MUST NOT be claimed without explicit verification.

#### Scenario: Message arrives while busy
- **WHEN** a conversation receives another message while running
- **THEN** it SHALL preserve its sender and authorization in the bounded queue or return a queue-full outcome

#### Scenario: Independent conversation progresses
- **WHEN** one conversation waits for a tool
- **THEN** another conversation SHALL make progress within the global budget

### Requirement: Authoritative scoped history and dynamic context
The host SHALL persist application history and adapt it to SDK sessions using one consistent continuation strategy. Dynamic recall changes MUST NOT reset the conversation. Private tool/recall results MUST NOT enter another principal's visible history.

#### Scenario: Recall changes next turn
- **WHEN** a later turn retrieves different authorized memories
- **THEN** the conversation SHALL continue without recreating it solely due to those memories

#### Scenario: Different group sender
- **WHEN** another sender enters the same group conversation
- **THEN** only authorized shared history SHALL be supplied and previous private context SHALL be excluded

### Requirement: Streaming cancellation and approval lifecycle
SDK stream events SHALL map to ordered typed application events. Public cancellation SHALL propagate to owned work. Approval interruptions SHALL persist as paused runs; resume MUST revalidate authorization and configuration rather than start an unrelated turn or replay effects.

#### Scenario: Stop during model execution
- **WHEN** an authorized stop command arrives
- **THEN** it SHALL bypass the normal queue and prevent late run outputs from being delivered

#### Scenario: Authorization revoked before approval resumes
- **WHEN** a paused tool is approved after its caller's authorization was revoked
- **THEN** resume SHALL reject the effect despite the approval decision

### Requirement: Explicit trace export policy
SDK tracing configuration SHALL explicitly control export destinations and sensitive input/output capture according to the application's policy. Local execution correlation SHALL remain available independently.

#### Scenario: Remote trace export disabled
- **WHEN** application policy disallows remote trace export
- **THEN** SDK traces SHALL not export chat/tool payloads externally while permitted local diagnostics remain available

### Requirement: Versioned persona references and faithful finalization
The model input SHALL keep root instructions separate from versioned persona and example reference anchors. Anchors SHALL be reused from retained history, replaced or revoked when configured content changes, and restored when compaction removes them. Examples MUST NOT become real assistant dialogue or tool evidence. Temporary retrieval SHALL appear after retained history and message metadata, before the active user input, without entering durable history.

#### Scenario: Step limit reached after searching from a quoted image
- **WHEN** the run reaches its tool-step limit
- **THEN** the final model call SHALL reuse the retained conversation, including quoted text, prepared images, persona anchors and balanced tool calls/results, with tools disabled and a limit notice appended
- **AND** it MUST NOT replace that conversation with task-only text and independently truncated tool excerpts

#### Scenario: Optional cumulative budget cannot accommodate the active conversation
- **WHEN** the remaining cumulative allowance cannot fit a faithful final request
- **THEN** the runtime SHALL report incomplete work deterministically instead of silently dropping evidence or replaying operations
