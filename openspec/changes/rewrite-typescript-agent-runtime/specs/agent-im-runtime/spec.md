## MODIFIED Requirements

### Requirement: Independent Agent and platform resource configuration
The system SHALL persist a validated TypeScript-runtime configuration with explicit runtime/schema identity, IM instances, LLM connections, independent Agents, shared resources and a single built-in flow configuration. Each Agent SHALL select an engine and its supported options while keeping runtime state separate.

#### Scenario: Agent selects resources
- **WHEN** an Agent selects an LLM, directories, skills, memory/knowledge libraries, persona and MCP/tools
- **THEN** its compiled runtime SHALL contain exactly the enabled authorized selection
- **AND** invalid references SHALL fail validation without replacing the active generation

#### Scenario: Unavailable engine
- **WHEN** an Agent selects an unsupported engine
- **THEN** activation SHALL fail explicitly rather than fall back to another engine

### Requirement: Ordered IM route activation
An IM SHALL enter the single built-in flow. Its Agent-selection node SHALL evaluate configured rules deterministically and choose a valid target or an explicit ignore/reject outcome. The Dashboard SHALL edit node parameters without changing topology.

#### Scenario: Default routes
- **WHEN** default flow settings are created
- **THEN** accepted private messages and qualifying group mentions/replies SHALL select the configured Agent
- **AND** recognized prefix commands SHALL be handled before any model execution

#### Scenario: Unmatched group message
- **WHEN** a group message fails the acceptance conditions
- **THEN** no Agent or model request SHALL execute

### Requirement: IM-specific identities and roles
The runtime SHALL derive trusted sender identity from the actual IM event, resolve grants in that IM/session context and construct an authorized turn runtime state.

#### Scenario: Different permissions across IMs
- **WHEN** the same identifier has higher grants on one IM but not another
- **THEN** executions SHALL receive their respective authorized states without cross-IM privilege inheritance

### Requirement: Direct development migration
Legacy configuration SHALL be imported explicitly with dry-run validation, a source backup, independent target storage and per-entity compatibility diagnostics. Migration MUST NOT delete source configuration or silently alter unsupported Agent engines.

#### Scenario: Migrated runtime
- **WHEN** a supported legacy installation is imported
- **THEN** Agent identities and resolvable resource ownership SHALL be preserved
- **AND** incompatible routes, engines or data SHALL be reported before activation
