## MODIFIED Requirements

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
