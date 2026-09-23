## MODIFIED Requirements

### Requirement: Sub-agent routing config
The system SHALL support strict, serializable sub-agent orchestration configuration owned by a versioned Workspace document.

#### Scenario: Current Workspace config exposes orchestration
- **GIVEN** a current-schema Workspace defines Agents, routes, and optional personas
- **WHEN** its snapshot is compiled
- **THEN** the snapshot exposes only validated enabled Agents, routes, and personas owned by that Workspace

#### Scenario: Legacy orchestration is migrated explicitly
- **GIVEN** an existing global config contains legacy orchestration fields
- **WHEN** the migration tool runs
- **THEN** it proposes equivalent Workspace-owned Agent and route definitions with diagnostics for conflicts
- **AND** strict current-schema loading does not merge global and Workspace orchestration implicitly

### Requirement: Routed Agent execution
The system SHALL execute the selected sub-agent using its complete effective Agent definition from the pinned Workspace snapshot and the common Agent runtime path.

#### Scenario: Selected Agent returns final response
- **GIVEN** a selected sub-agent has a validated provider, model, and tool set
- **WHEN** the orchestrator runs a message
- **THEN** the response includes selected Agent id and final content

#### Scenario: Selected Agent uses pinned Workspace behavior
- **GIVEN** a message pinned Workspace snapshot version `N`
- **WHEN** the orchestrator selects an Agent for that message
- **THEN** provider, model, generation, context, execution, persona, memory, and tool settings are read from version `N`

#### Scenario: Dashboard route test uses common execution path
- **GIVEN** a Dashboard route test and platform message select the same Workspace and permission group
- **WHEN** both select the same sub-agent
- **THEN** both use the same effective Agent definition, provider lookup, prompt, and tool policy

## ADDED Requirements

### Requirement: Orchestration references are validated before activation
The system SHALL reject a Workspace candidate whose primary Agent, default Agent, route target, provider, persona, or named tool reference cannot be resolved.

#### Scenario: Route target does not exist
- **GIVEN** a route targets an Agent id not present in the Workspace
- **WHEN** the Workspace candidate is compiled
- **THEN** activation fails with a diagnostic naming the route and target
- **AND** the previous Workspace snapshot remains active

#### Scenario: No route match uses explicit fallback
- **GIVEN** orchestration has no matching route
- **WHEN** selection runs
- **THEN** it selects the validated default Agent when configured, otherwise the validated primary Agent
- **AND** records the fallback reason
