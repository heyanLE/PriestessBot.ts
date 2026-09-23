## MODIFIED Requirements

### Requirement: PreProcess stage
The system SHALL load conversation history and assemble Agent context exclusively from the effective runtime and Workspace snapshots already pinned by Workspace preparation.

#### Scenario: PreProcess attaches system prompt
- **WHEN** PreProcessStage processes an event
- **THEN** the selected Agent's effective System Prompt is prepended to the message context

#### Scenario: PreProcess loads conversation history
- **WHEN** a conversation exists for the current session
- **THEN** the recent message history is loaded and attached to the context

#### Scenario: PreProcess consumes pinned snapshots
- **WHEN** `PreProcessStage` processes an accepted event
- **THEN** it reads the already-pinned effective runtime and Workspace snapshots from the pipeline context
- **AND** it does not re-resolve config files, environment variables, Workspace ids, or directories

#### Scenario: PreProcess attaches Workspace-scoped skill availability
- **GIVEN** the pinned Workspace snapshot contains enabled skills
- **WHEN** PreProcessStage builds the message context
- **THEN** only skills visible in that snapshot are available for the current pipeline run

#### Scenario: Agent prompt renders context blocks
- **WHEN** the Agent loop sends a request to the LLM provider
- **THEN** the system prompt contains separate Platform, Role Document, Tools, and Loaded Skills blocks

#### Scenario: Skill tool loads prompt content
- **GIVEN** a Workspace-visible skill exists
- **WHEN** the LLM calls `use_skill` with that skill name
- **THEN** the current pipeline skill state loads that skill's prompt document
- **AND** later LLM requests in the same Agent run include the loaded `SKILL.md` content in the Loaded Skills block

### Requirement: PrepareWorkspace stage
The system SHALL provide a `PrepareWorkspaceStage` before `PreProcessStage` that pins the current effective runtime snapshot, selects a registered Workspace id, and pins its active Workspace snapshot.

#### Scenario: PrepareWorkspace applies Workspace selection precedence
- **GIVEN** optional message Workspace id, catalog selection rules, platform default Workspace id, and global default Workspace id
- **WHEN** `PrepareWorkspaceStage` selects a Workspace
- **THEN** it applies that precedence in order
- **AND** records the selected id and provenance

#### Scenario: PrepareWorkspace uses active snapshots
- **WHEN** `PrepareWorkspaceStage` prepares a message
- **THEN** it obtains a coherent active runtime snapshot and referenced Workspace snapshot
- **AND** stores both versions on the pipeline context before later stages execute
- **AND** it does not read source files directly

## ADDED Requirements

### Requirement: Pipeline execution uses one configuration generation
The system SHALL use the pinned effective runtime and Workspace snapshots for all configuration-dependent decisions in a message pipeline.

#### Scenario: Reload occurs during a message
- **GIVEN** a message pinned runtime snapshot `R` and Workspace snapshot `W`
- **WHEN** newer snapshots activate before the message finishes
- **THEN** waking, permissions, commands, Agent selection, provider lookup, prompt construction, tools, memory, and response processing continue using `R` and `W`

#### Scenario: Later message uses newer generation
- **GIVEN** runtime snapshot `R+1` and Workspace snapshot `W+1` activated successfully
- **WHEN** a later message enters the pipeline
- **THEN** it pins `R+1` and the selected active Workspace snapshot

### Requirement: Pipeline metadata exposes configuration trace
The system SHALL record non-secret configuration version and selection trace metadata for diagnostics.

#### Scenario: Configuration trace is recorded
- **WHEN** Workspace preparation succeeds
- **THEN** pipeline metadata contains active runtime version, desired config revision, Workspace id and version, selected Agent id when known, and Workspace selection provenance
- **AND** it contains no resolved secrets
