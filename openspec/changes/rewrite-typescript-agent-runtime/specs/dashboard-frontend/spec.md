## MODIFIED Requirements

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

## ADDED Requirements

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
