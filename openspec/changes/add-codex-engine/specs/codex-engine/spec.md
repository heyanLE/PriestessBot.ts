## ADDED Requirements

### Requirement: Codex runs through a pinned in-process native engine

The runtime SHALL call the pinned Rust Codex engine through JNI, without a Codex login or a separate app-server process. It SHALL use a custom Responses provider derived from the Agent's effective LLM connection and keep credentials out of configuration files and diagnostics.

#### Scenario: Mock Responses turn
- **WHEN** a CODEX turn is submitted against a compatible mock Responses endpoint
- **THEN** its final native assistant message is returned as `AgentResponse.Final`

### Requirement: Native event delivery is acknowledged and bounded

One Rust event pump SHALL own each native thread's event source. A JVM consumer SHALL acknowledge an event only after handling it; an unacknowledged event SHALL be returned again. Native payload and queue sizes SHALL be bounded.

#### Scenario: JVM consumer is cancelled between poll and handling
- **WHEN** a poll returns an event but the consumer does not acknowledge it
- **THEN** a later poll receives that same event

### Requirement: Conversation ownership survives process restart

The runner SHALL map `(workspaceId, agentId, platformId, sessionId)` to a persisted rollout. It SHALL serialize turns for one conversation while allowing independent conversations to progress. A changed provider or instruction generation SHALL not silently continue using stale configuration.

#### Scenario: Same conversation after restart
- **WHEN** a compatible stored rollout exists after the native engine is reopened
- **THEN** the runner resumes that rollout instead of replaying the local transcript

### Requirement: Unbridged native actions fail closed

Until the route-scoped tool permission bridge is complete, a CODEX turn SHALL advertise no dynamic tools and SHALL require a `NONE` IM tool-injection route. An unexpected dynamic tool or approval request SHALL be denied and the turn interrupted.
