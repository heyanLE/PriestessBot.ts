# dashboard-frontend Specification

## Purpose
TBD - created by archiving change dashboard-frontend-foundation. Update Purpose after archive.

> TypeScript requirements apply to runtime `priestess-ts`. Unmodified Kotlin/workspace-specific requirements below remain reference requirements for the legacy runtime.

## Requirements

### Requirement: Dashboard frontend application
The system SHALL retain the Vue Dashboard, build it independently from the TypeScript server and consume shared strictly typed validated contracts.

#### Scenario: Frontend build
- **WHEN** the Dashboard build runs
- **THEN** strict type checks SHALL pass before producing static assets

### Requirement: Operational navigation
The Dashboard SHALL follow AstrBotX’s overview, robot, model-service, extension, permissions and knowledge navigation with object list/detail editors. It SHALL retain Agent as a first-class page, provide separate chat and execution-record pages, and add the single flow as an independent page. Navigation SHALL support browser history and preserve the shared configuration draft.

#### Scenario: Navigate to routing
- **WHEN** an operator opens routing
- **THEN** the single built-in flow SHALL be displayed with editable node parameters and fixed connections

#### Scenario: Legacy workspace link
- **WHEN** a supported legacy workspace link is opened
- **THEN** it SHALL resolve to the appropriate independent Agent/configuration view rather than require a removed workspace model

### Requirement: API-backed status views
The Dashboard frontend SHALL use backend REST APIs for health, platforms, providers, tools, conversations, plugins, configuration, config backups, and workspaces.

#### Scenario: Runtime config view lists backups

- **GIVEN** the Dashboard frontend is open
- **WHEN** the Runtime Config view loads
- **THEN** it SHALL request `GET /api/config/backups`
- **AND** display backup IDs, creation timestamps, sizes, and paths without config contents

#### Scenario: Runtime config view restores backup

- **GIVEN** a config backup is listed
- **WHEN** an operator selects restore for that backup
- **THEN** the Dashboard SHALL call `POST /api/config/backups/{id}/restore`
- **AND** update the active config editor with the restored config

#### Scenario: Workspace view lists statuses
- **GIVEN** the Dashboard frontend is open
- **WHEN** the Workspaces view loads
- **THEN** it requests `GET /api/workspaces`
- **AND** displays each workspace id, name, enabled state, active snapshot version, loaded timestamp, and last reload status

#### Scenario: Workspace detail shows scoped summaries
- **GIVEN** an operator selects a workspace
- **WHEN** the workspace detail panel loads
- **THEN** it displays scoped summaries for skills, MCP servers/tools, built-in/plugin tools, personas, and memory policy
- **AND** displays the active snapshot version and recent reload errors when present

#### Scenario: Operator reloads one workspace
- **GIVEN** a workspace is visible in the Workspaces view
- **WHEN** the operator triggers reload for that workspace
- **THEN** the frontend calls `POST /api/workspaces/{id}/reload`
- **AND** updates the displayed status from the returned reload result

#### Scenario: Operator reloads all workspaces
- **WHEN** the operator triggers reload all
- **THEN** the frontend calls `POST /api/workspaces/reload`
- **AND** updates each displayed workspace status from the returned results

#### Scenario: Failed reload keeps active snapshot visible
- **GIVEN** a workspace reload fails
- **WHEN** the Workspaces view refreshes
- **THEN** it shows the failure summary
- **AND** still shows the active snapshot version that remains in use

### Requirement: Realtime log stream
The Dashboard frontend SHALL connect to the backend log WebSocket.

#### Scenario: Log socket receives messages
- **GIVEN** the backend log socket is available
- **WHEN** the Log view opens
- **THEN** it connects to `/ws/logs`
- **AND** renders received log events

#### Scenario: Runtime log socket receives messages

- **GIVEN** the backend log socket is available
- **WHEN** the Log view opens
- **THEN** it connects to `/ws/logs`
- **AND** renders connected, buffered, and live log events

### Requirement: Knowledge management view
The Dashboard frontend SHALL provide a Knowledge view for operator-managed RAG content.

#### Scenario: Operator opens Knowledge view
- **GIVEN** the Dashboard is running
- **WHEN** the operator opens `/knowledge`
- **THEN** the frontend loads and displays knowledge bases

#### Scenario: Operator creates knowledge base
- **GIVEN** the Knowledge view is open
- **WHEN** the operator submits a new base name
- **THEN** the frontend calls the knowledge base create API
- **AND** refreshes the displayed base list

#### Scenario: Operator adds text document
- **GIVEN** a knowledge base exists
- **WHEN** the operator submits document text
- **THEN** the frontend calls the add document API
- **AND** displays the stored chunk count

#### Scenario: Operator tests retrieval
- **GIVEN** indexed document chunks exist
- **WHEN** the operator submits a search query
- **THEN** the frontend calls the knowledge search API
- **AND** displays scored result snippets

### Requirement: Conversation detail view
The Dashboard frontend SHALL provide a detail view for a selected conversation.

#### Scenario: Operator opens a conversation
- **GIVEN** the conversation list is visible
- **WHEN** the operator selects a conversation
- **THEN** the Dashboard navigates to `/conversations/{id}`
- **AND** loads the message history for that conversation

### Requirement: Message transcript rendering
The conversation detail view SHALL render message roles, content, timestamps, and tool metadata.

#### Scenario: Tool messages are visible
- **GIVEN** a conversation contains assistant tool calls and tool responses
- **WHEN** the operator opens the conversation detail view
- **THEN** tool call payloads and tool call ids are displayed alongside the transcript

### Requirement: Agent Dashboard view
The Dashboard frontend SHALL include an Agent view for inspecting and testing the active Agent.

#### Scenario: Operator opens Agent view
- **GIVEN** the Dashboard has loaded runtime config
- **WHEN** the operator opens `/agent`
- **THEN** the view displays the active Agent name, provider, model, limits, available providers, and available tools

### Requirement: Agent test chat
The Agent view SHALL let operators send a test message to the Agent chat API.

#### Scenario: Operator tests a message
- **GIVEN** the Agent view is open
- **WHEN** the operator sends a message
- **THEN** the frontend posts it to `/api/agent/chat`
- **AND** displays both the user message and Agent response
- **AND** displays returned execution events

### Requirement: Dashboard overview SHALL show runtime diagnostics

The Dashboard overview SHALL show health diagnostics returned by the backend.

#### Scenario: Operator inspects diagnostics

- **GIVEN** the health response contains diagnostics
- **WHEN** the operator opens the Dashboard overview
- **THEN** the overview SHALL render the diagnostic key/value pairs

### Requirement: Sub-agent dashboard page
The Dashboard frontend SHALL provide a sub-agent routing page for managing orchestration configuration.

#### Scenario: Structured runtime controls update draft config
- **GIVEN** the sub-agent page has a valid draft config
- **WHEN** an operator toggles orchestration or changes the default agent
- **THEN** the JSON editor draft is updated with the new config value

#### Scenario: Structured agent editing updates draft config
- **GIVEN** the sub-agent page has a valid draft config
- **WHEN** an operator adds or removes a sub-agent
- **THEN** the JSON editor draft is updated
- **AND** route/default references to removed agents are cleaned up

#### Scenario: Structured route editing updates draft config
- **GIVEN** the sub-agent page has a valid draft config with at least one agent
- **WHEN** an operator adds, edits, enables/disables, or removes a route
- **THEN** the JSON editor draft reflects the route changes
- **AND** save/test actions use the updated draft

#### Scenario: Navigate to sub-agent page
- **WHEN** an operator opens the Dashboard sidebar
- **THEN** a Sub-Agents navigation entry is visible
- **AND** selecting it opens `/sub-agents`

#### Scenario: Edit and save sub-agent config
- **GIVEN** the sub-agent page has loaded the current config
- **WHEN** an operator edits valid JSON and saves it
- **THEN** the frontend sends the config to the sub-agent config API
- **AND** the page updates the editor and summary from the saved response

#### Scenario: Reject invalid config JSON
- **GIVEN** the sub-agent page is open
- **WHEN** an operator enters invalid JSON
- **THEN** save and test actions show an inline error instead of calling the API

### Requirement: Sub-agent test runner
The Dashboard frontend SHALL allow operators to test routing and selected-agent execution.

#### Scenario: Test draft config
- **GIVEN** the sub-agent page has a valid draft config
- **WHEN** an operator submits a test message
- **THEN** the frontend calls the sub-agent test API with the draft config
- **AND** displays status, selected agent, selected route, selection reason, response content, and execution events

### Requirement: Dashboard frontend SHALL support API token access

The Dashboard frontend SHALL attach an operator-provided API token to protected backend calls.

#### Scenario: REST API token is stored from URL query

- **GIVEN** the Dashboard opens with `?token=secret`
- **WHEN** the frontend sends REST API requests
- **THEN** it SHALL include `Authorization: Bearer secret`

#### Scenario: Log socket token is sent through query parameter

- **GIVEN** a Dashboard API token is available in browser storage
- **WHEN** the Log view connects to `/ws/logs`
- **THEN** the WebSocket URL SHALL include the token query parameter

### Requirement: Persona management view
The Dashboard frontend SHALL provide a Persona view for managing Agent personas.

#### Scenario: Operator opens Persona view
- **GIVEN** the Dashboard is running
- **WHEN** the operator opens `/personas`
- **THEN** the frontend loads personas from the Dashboard API
- **AND** displays persona name, enabled state, assigned agents, and update time

#### Scenario: Operator creates or edits persona
- **GIVEN** the Persona view is open
- **WHEN** the operator submits valid persona fields
- **THEN** the frontend calls the persona create or update API
- **AND** refreshes the displayed persona list

#### Scenario: Operator deletes persona
- **GIVEN** a persona is listed
- **WHEN** the operator confirms deletion
- **THEN** the frontend calls `DELETE /api/personas/{id}`
- **AND** removes the persona from the list after success

### Requirement: Memory management view
The Dashboard frontend SHALL provide a Memory view for managing long-term memory records.

#### Scenario: Operator opens Memory view
- **GIVEN** the Dashboard is running
- **WHEN** the operator opens `/memory`
- **THEN** the frontend loads memory records from the Dashboard API
- **AND** displays type, scope, tags, confidence, expiry, and update time

#### Scenario: Operator filters and searches memory
- **GIVEN** memory records exist
- **WHEN** the operator applies filters or submits a search query
- **THEN** the frontend calls the matching memory list or search API
- **AND** displays result scores and match reasons for search results

#### Scenario: Operator creates memory
- **GIVEN** the Memory view is open
- **WHEN** the operator submits valid memory content, type, scope, and required scope keys
- **THEN** the frontend calls `POST /api/memory`
- **AND** refreshes the displayed memory list

#### Scenario: Operator deletes memory by exact id
- **GIVEN** a memory record is listed
- **WHEN** the operator confirms deletion for that record
- **THEN** the frontend calls `DELETE /api/memory/{id}`
- **AND** removes the record from the list after success

#### Scenario: Operator runs memory expiry cleanup
- **GIVEN** the Memory view is open
- **WHEN** the operator triggers expiry cleanup
- **THEN** the frontend calls `POST /api/memory/expire`
- **AND** displays the affected record count

### Requirement: Agent chat injection trace display
The Dashboard frontend SHALL show persona and memory injection trace returned by the Agent chat test API.

#### Scenario: Operator inspects chat injection trace
- **GIVEN** an Agent chat test response includes injection trace
- **WHEN** the Agent view renders the response
- **THEN** the view displays the injected persona id or name
- **AND** displays injected memory ids, scores, and match reasons

#### Scenario: Empty injection trace is handled
- **GIVEN** an Agent chat test response has no injected persona or memory
- **WHEN** the Agent view renders the response
- **THEN** the view remains usable without showing stale trace data from an earlier run

### Requirement: Dashboard ToolView SHALL show tool policy and status
The Dashboard frontend SHALL provide a ToolView that lets operators inspect registered tool permission, enablement, source, and health/status state.

#### Scenario: ToolView renders policy metadata
- **GIVEN** the ToolView loads tool metadata from the Dashboard API
- **WHEN** tools are displayed
- **THEN** each tool row SHALL show name, description, source, risk level, effective enabled state, default enabled state, audit flag, and unavailable/status reason when present

#### Scenario: ToolView supports operational filtering
- **GIVEN** the ToolView has loaded tools
- **WHEN** an operator filters by source, risk level, enabled state, or text query
- **THEN** the visible tools SHALL match the selected filters

#### Scenario: ToolView highlights risky and unavailable tools
- **GIVEN** a tool is high risk, disabled, or unavailable
- **WHEN** the ToolView renders that tool
- **THEN** the tool state SHALL be visually distinguishable from enabled safe-read tools

#### Scenario: ToolView uses typed API model
- **WHEN** frontend code consumes the tool API
- **THEN** the API client types SHALL include tool source, risk level, required capabilities, default enabled state, effective enabled state, audit flag, and status reason

### Requirement: Existing visual identity preservation
The Dashboard SHALL preserve the current Logo and use its green tone for primary actions and selection, with pale green navigation and white working surfaces as described in dashboard/DESIGN.md. It SHALL retain readable typography, restrained shadows and a responsive shell. This palette supersedes the earlier parchment/ivory/gold direction.

#### Scenario: New flow view
- **WHEN** flow nodes and parameter editors are rendered
- **THEN** they SHALL reuse the existing visual tokens and components rather than introduce a separate canvas theme

#### Scenario: Visual regression verification
- **WHEN** the TypeScript Dashboard is qualified for release
- **THEN** representative desktop/narrow-screen views SHALL be compared against captured current-version baselines

### Requirement: Node edit and publish interaction
The flow UI SHALL support selection, typed parameter forms, draft preservation, validation, simulation, revision-aware publication, rollback and recorded path inspection without free-form topology editing.

#### Scenario: Draft node edit
- **WHEN** an operator edits a node and navigates to another node
- **THEN** the unsaved draft SHALL be retained and SHALL not alter the active flow until publication
