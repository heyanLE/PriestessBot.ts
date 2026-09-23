## ADDED Requirements

### Requirement: Agent runtime consumes the complete effective Agent definition
The Agent runtime SHALL construct each Agent from its pinned Workspace `EffectiveAgent` and SHALL apply every supported generation, context, execution, persona, provider, model, and tool policy field.

#### Scenario: Temperature reaches provider request
- **GIVEN** the selected effective Agent has temperature `0.2`
- **WHEN** the Agent runner creates an LLM request
- **THEN** the request uses temperature `0.2`
- **AND** it does not silently use an unrelated request default

#### Scenario: Execution limits reach the runner and executor
- **GIVEN** the selected effective Agent defines max steps and tool timeout
- **WHEN** the Agent runs
- **THEN** the runner uses the configured max steps
- **AND** ToolExecutor receives the configured timeout

#### Scenario: Agent model and provider are explicit
- **GIVEN** an effective Agent references a validated provider and model
- **WHEN** the first LLM request is created
- **THEN** those exact provider and model ids are used
- **AND** no first-provider or provider-default-model fallback is applied

### Requirement: Agent prompt and execution share one effective tool set
The Agent loop SHALL use the same permission-narrowed effective tool set for LLM tool definitions and ToolExecutor lookup.

#### Scenario: Disallowed tool is absent from prompt and executor
- **GIVEN** a tool is removed by Workspace, Agent, risk-level, or sender permission policy
- **WHEN** Agent context and ToolExecutor scope are created
- **THEN** the tool is absent from the LLM request tool definitions
- **AND** it is absent from the scoped executable registry

#### Scenario: Dashboard and platform runs have equivalent tool resolution
- **GIVEN** Dashboard chat and a platform message select the same Workspace, Agent, and permission group
- **WHEN** both Agent contexts are constructed
- **THEN** both expose the same effective tool ids

### Requirement: Agent runtime does not read authoring configuration
The Agent runner and controller SHALL NOT read raw global config, Workspace source documents, environment variables, or source files during message execution.

#### Scenario: Source file changes before reload
- **GIVEN** an Agent run pinned snapshot version `N`
- **AND** a source file changes without successful activation
- **WHEN** the run performs later LLM or tool steps
- **THEN** it continues using effective Agent version `N`
