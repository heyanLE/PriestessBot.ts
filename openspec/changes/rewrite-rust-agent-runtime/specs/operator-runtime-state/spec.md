## ADDED Requirements

### Requirement: Three route-selected runtime states
The system SHALL support 普通干员态, 资深干员态 and 高级资深干员态 in increasing order. New runs SHALL begin in 普通干员态 unless a trusted published route node selects another state. Sender identity SHALL be condition data and SHALL NOT implicitly override that selection.

#### Scenario: Route grants a state
- **WHEN** a published SetRuntimeState node selects 高级资深干员态
- **THEN** downstream execution SHALL use that state and record its node and graph revision.

#### Scenario: Message attempts to set state
- **WHEN** user text or a tool response contains a runtime state field
- **THEN** it SHALL NOT modify the trusted run state.

### Requirement: Capability and resource intersection
Every command, tool, MCP call, execution environment and memory mutation SHALL check the selected state capabilities intersected with Agent resources and environment restrictions.

#### Scenario: High state without a resource
- **WHEN** a high-state run requests a tool or library not assigned to the Agent
- **THEN** access SHALL be denied.

### Requirement: Child authorization inheritance
Child runs SHALL inherit the parent's state and effective permissions and SHALL only narrow them according to the target Agent.

#### Scenario: Privileged target Agent
- **WHEN** a low-permission parent delegates to an Agent with broader configured tools
- **THEN** the child SHALL NOT gain capabilities absent from the parent.

### Requirement: Separate graph publication authority
Graph publication SHALL require authenticated management authority independent of a chat's runtime state.

#### Scenario: High-state chat calls management API
- **WHEN** a chat holds 高级资深干员态 but has no management credential
- **THEN** graph publication SHALL be denied.
