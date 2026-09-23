## MODIFIED Requirements

### Requirement: Ordered IM route activation
An IM SHALL activate only through its first enabled matching route, targeting an Agent or the built-in command system, evaluated in the operator-configured order.

#### Scenario: Default routes
- **WHEN** default routes are created for an Agent
- **THEN** group attention plus normalized # prefix SHALL target commands before group attention targets the Agent, followed by private # commands and private Agent messages
- **AND** the Dashboard SHALL allow changing attention conditions, target, text matching, session types and ordering

#### Scenario: Unmatched group message
- **WHEN** no route matches an input
- **THEN** no Agent or model request SHALL execute

#### Scenario: Unreachable route is reported
- **WHEN** an earlier enabled route's text pattern strictly subsumes a later enabled route's pattern for the same session types
- **THEN** configuration validation SHALL report the later route as unreachable
- **AND** the route table SHALL remain loadable so the operator can reorder or narrow it

### Requirement: Direct development migration
Legacy v2 configuration SHALL be converted once into the new authoring model without creating backups, as requested by the operator.

#### Scenario: Migrated runtime
- **WHEN** a valid v2 installation is migrated
- **THEN** IM routes SHALL reference real independent Agents and reusable resources SHALL retain resolvable ownership
- **AND** subsequent editing and startup SHALL use v3 as the sole authoring source

#### Scenario: Migrated routes order specific keywords first
- **WHEN** a legacy Workspace declares keyword orchestration routes
- **THEN** within one legacy priority the generated routes SHALL be ordered by descending keyword specificity
- **AND** a generated keyword that another generated keyword contains SHALL NOT be evaluated first

#### Scenario: Lost delegation role is reported
- **WHEN** migration carries over a Workspace orchestrator Agent whose designated role was routing to other Agents, and the deployment exposes no delegation capability
- **THEN** the result SHALL report a diagnostic naming that Agent
- **AND** migration SHALL NOT rewrite the Agent's operator-authored instructions
