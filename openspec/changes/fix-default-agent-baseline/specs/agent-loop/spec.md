## ADDED Requirements

### Requirement: Agent runtime defaults are explicit and consistent
The system SHALL derive every Agent's context window and step budget from its configuration, and the configuration model, the compiled Agent, and the Dashboard Agent factory SHALL report the same defaults so that a newly created Agent does not start with a budget smaller than one assembled request.

#### Scenario: New Agent receives a usable default window
- **WHEN** an Agent is created without explicit context compression settings
- **THEN** its context window SHALL default to a value that accommodates the assembled system prompt plus at least one tool result

#### Scenario: New Agent receives a usable default step budget
- **WHEN** an Agent is created without explicit execution settings
- **THEN** its maximum step count SHALL default to a value that permits a multi-step tool workflow rather than a single tool call

#### Scenario: The default sources cannot drift
- **WHEN** the configuration model, the compiled Agent, or the Dashboard Agent factory changes its default context window or step budget
- **THEN** a test SHALL fail unless all three report the same values

#### Scenario: Explicit operator values are preserved
- **WHEN** a configuration persists an explicit context window or step budget
- **THEN** the runtime SHALL use that value and SHALL NOT replace it with the default

### Requirement: System prompt is composed from ordered sections
The Agent system prompt SHALL be assembled from an explicitly ordered list of named sections that each render to text and are omitted when empty, and the Agent's role document SHALL precede platform mechanics.

#### Scenario: Role document precedes platform facts
- **WHEN** the Agent runner builds the system prompt for a request
- **THEN** the Agent role document SHALL appear before the Platform, Message Identity, Agent Directories, formatting and delivery sections

#### Scenario: Empty sections are omitted
- **WHEN** a section has no content for the current request
- **THEN** it SHALL NOT contribute text to the system prompt

#### Scenario: Tool schemas are not restated as prompt text
- **WHEN** tools are visible to the Agent
- **THEN** their schemas SHALL be delivered as provider-native function definitions
- **AND** the system prompt SHALL NOT contain a plain-text enumeration of tool names and descriptions

#### Scenario: Permission mechanics are not disclosed
- **WHEN** the caller's permission group does not satisfy a tool's requirement
- **THEN** that tool SHALL be absent from the request
- **AND** the system prompt SHALL NOT contain permission-denial text for that tool

#### Scenario: Skill blocks are preserved
- **WHEN** skills are available or loaded for the current run
- **THEN** the system prompt SHALL still contain the available-skill and loaded-skill blocks
