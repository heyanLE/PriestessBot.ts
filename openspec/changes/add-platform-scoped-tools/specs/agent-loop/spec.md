## ADDED Requirements

### Requirement: Agent loop intersects current Platform tools
The Agent loop SHALL construct prompt and executor tools from registered runtime tools, compiled Workspace/Agent policy, sender permission, and only the current message Platform's scoped contributions.

#### Scenario: Prompt and executor use identical Platform set
- **WHEN** a Platform tool survives effective policy and permission filtering
- **THEN** it is present in both the provider request tool definitions and scoped ToolExecutor lookup

#### Scenario: Compiled ID has no current executable
- **GIVEN** an effective Agent allows a tool contributed by another Platform type
- **WHEN** the current message Platform does not contribute that executable
- **THEN** the tool is absent from the prompt and executor
