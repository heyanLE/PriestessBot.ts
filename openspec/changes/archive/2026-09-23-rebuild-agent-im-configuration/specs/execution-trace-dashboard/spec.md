## ADDED Requirements

### Requirement: Durable execution chains
The system SHALL record a summary and ordered events for each execution, including actual model requests/responses, tools, token usage, timing, errors and terminal status.

#### Scenario: Inspect a failed execution
- **WHEN** a model or tool fails
- **THEN** the execution detail SHALL show its completed preceding steps and the failing event
- **AND** the run SHALL terminate as failed or cancelled rather than remain running

### Requirement: System and LLM log separation
The Dashboard SHALL provide separate system logs and execution-chain logs, with execution filtering by IM, LLM, Agent and status.

#### Scenario: Filter and inspect
- **WHEN** an operator filters executions by IM and LLM and selects a row
- **THEN** the detail SHALL display only that run's ordered events with paginated bounded payloads

### Requirement: Structured configuration Dashboard
The Dashboard SHALL support creating/editing Agents and IM instances, ordered route editing/testing, and enabling selected platform resources while retaining the current visual style.

#### Scenario: Configure and route to a new Agent
- **WHEN** an operator creates a valid Agent and chooses it in an IM route
- **THEN** saved settings SHALL compile and the route test SHALL report the chosen Agent and normalized input
- **AND** resource selectors SHALL clearly distinguish platform, configuration-directory and temporary skills
