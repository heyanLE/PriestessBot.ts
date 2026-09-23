## MODIFIED Requirements

### Requirement: PreProcess stage
The system SHALL load conversation history, resolve a workspace snapshot, and attach workspace-scoped runtime context before the Agent loop.

#### Scenario: PreProcess attaches system prompt
- **WHEN** PreProcessStage processes an event
- **THEN** the Agent's System Prompt is prepended to the message context

#### Scenario: PreProcess loads conversation history
- **WHEN** a conversation exists for the current session
- **THEN** the recent message history is loaded and attached to the context

#### Scenario: PreProcess consumes pinned workspace snapshot
- **WHEN** `PreProcessStage` processes an accepted event
- **THEN** it reads the already-pinned workspace snapshot from the pipeline context
- **AND** it does not re-resolve the workspace directory on its own

#### Scenario: PreProcess attaches workspace-scoped skill availability
- **GIVEN** the resolved workspace snapshot contains enabled skills
- **WHEN** PreProcessStage builds the message context
- **THEN** only the skills visible in that workspace snapshot are available for the current Pipeline run

#### Scenario: PreProcess resolves workspace snapshot
- **WHEN** PreProcessStage processes an accepted event
- **THEN** it resolves a workspace snapshot from the event platform, session, user, group, and metadata context
- **AND** stores the snapshot on the pipeline context

#### Scenario: Agent prompt renders context blocks
- **WHEN** the Agent loop sends a request to the LLM provider
- **THEN** the system prompt SHALL begin with the Agent role document
- **AND** it SHALL contain separate Platform, Message Identity, Agent Directories, and Loaded Skills blocks
- **AND** it SHALL NOT enumerate tools as prompt text, because their schemas are delivered as provider-native function definitions

#### Scenario: Skill tool loads prompt content
- **GIVEN** a workspace-visible skill exists
- **WHEN** the LLM calls `use_skill` with that skill name
- **THEN** the current Pipeline skill state loads that skill's prompt document
- **AND** later LLM requests in the same Agent run include the loaded `SKILL.md` content in the Loaded Skills block
