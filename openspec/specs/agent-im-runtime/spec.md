# agent-im-runtime Specification

## Purpose
TBD - created while syncing archived changes. Update Purpose after archive.

## Requirements

### Requirement: Independent Agent and platform resource configuration
The system SHALL persist one v3 configuration model with system runtime, a platform resource directory, IM instances, LLM connections, independent Agents, and shared skill/memory/MCP/tool catalogs. Each Agent SHALL additionally select the preset that determines how it operates.

#### Scenario: Agent selects resources
- **WHEN** an Agent selects an LLM, directories, skill mounts, memory libraries, one persona and MCP/tools
- **THEN** its compiled runtime SHALL contain exactly the enabled, authorized selection
- **AND** invalid references SHALL fail validation without replacing the active generation

#### Scenario: Agent selects its behaviour preset
- **WHEN** an Agent selects a registered preset
- **THEN** its compiled runtime SHALL carry that preset
- **AND** an unregistered preset SHALL fail validation without replacing the active generation

#### Scenario: Preset selection is optional
- **WHEN** an Agent omits the preset
- **THEN** it SHALL compile with the simple chat preset and SHALL behave as it did before presets existed

### Requirement: Ordered IM route activation
An IM SHALL activate only through its first enabled matching route, targeting an Agent or the built-in command system.

#### Scenario: Default routes
- **WHEN** default routes are created for an Agent
- **THEN** group attention plus normalized # prefix SHALL target commands before group attention targets the Agent, followed by private # commands and private Agent messages
- **AND** the Dashboard SHALL allow changing attention conditions, target, text matching, session types and ordering

#### Scenario: Unmatched group message
- **WHEN** no route matches an input
- **THEN** no Agent or model request SHALL execute

### Requirement: IM-specific identities and roles
The runtime SHALL derive sender identity and permission from the actual IM event and that IM's role lists, and pass those facts into the selected Agent.

#### Scenario: Different permissions across IMs
- **WHEN** the same user identifier has an administrative role on one IM but not another
- **THEN** the two executions SHALL receive their respective IM roles without cross-IM privilege inheritance

### Requirement: Three skill sources and isolated memory libraries
Agent composition SHALL support platform-library, configuration-directory and temporary-directory skills with explicit permission requirements, and SHALL restrict memory retrieval/injection/writes to its selected enabled libraries and scopes.

#### Scenario: Disabled memory library
- **WHEN** a library is not selected or is disabled
- **THEN** neither automatic context injection nor a memory tool SHALL read or write it

#### Scenario: Persona selection and examples
- **WHEN** an Agent selects a persona
- **THEN** only that persona SHALL be injected
- **AND** its examples SHALL be labeled style reference outside real persisted conversation turns

### Requirement: Direct development migration
Legacy v2 configuration SHALL be converted once into the new authoring model without creating backups, as requested by the operator.

#### Scenario: Migrated runtime
- **WHEN** a valid v2 installation is migrated
- **THEN** IM routes SHALL reference real independent Agents and reusable resources SHALL retain resolvable ownership
- **AND** subsequent editing and startup SHALL use v3 as the sole authoring source
