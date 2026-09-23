## MODIFIED Requirements

### Requirement: Sub-agent Dashboard API
The Dashboard API SHALL expose Workspace-owned orchestration views and execute route tests through the same pinned runtime path as platform traffic.

#### Scenario: Read Workspace orchestration config
- **GIVEN** the Dashboard API is running
- **WHEN** an operator requests orchestration for a Workspace id
- **THEN** the API returns that Workspace's redacted raw orchestration, active version, and diagnostics
- **AND** it does not return a separate global orchestration authority

#### Scenario: Replace Workspace orchestration config
- **GIVEN** the Dashboard API is running
- **WHEN** an operator previews and applies a new Workspace document with its expected revision
- **THEN** the API validates, persists, and activates it through the Workspace compiler
- **AND** returns desired revision, active version, diagnostics, and activation status

#### Scenario: Test route execution
- **GIVEN** an active Workspace orchestration snapshot is present
- **WHEN** an operator posts a test message with Workspace id and permission context
- **THEN** the API pins the current runtime and Workspace snapshots
- **AND** returns selected Agent, selected route, selection reason, snapshot versions, status, content, and events

### Requirement: Dashboard HTTP server
The system SHALL provide an optional Ktor Dashboard API server and SHALL expose configuration through redacted authoring, validation, effective, provenance, and activation views.

#### Scenario: Server exposes health endpoint
- **WHEN** the Dashboard API server is running
- **THEN** `GET /health` returns a JSON health response
- **AND** the response includes component status, resolved config source path, active snapshot version, and pending restart summary without secrets

#### Scenario: Legacy server exposes redacted compatibility configuration
- **WHEN** a dashboard client calls deprecated `GET /api/config`
- **THEN** the server returns a redacted compatibility view
- **AND** the view distinguishes raw, environment-derived, active, and pending values instead of serializing internal `PriestessConfig`

#### Scenario: Legacy full replacement is rejected or migrated
- **WHEN** a dashboard client calls deprecated `PUT /api/config`
- **THEN** the server either rejects it with links to preview/apply operations or translates it through the explicit legacy migration adapter
- **AND** it never directly mutates and republishes independent config flows

## ADDED Requirements

### Requirement: Dashboard exposes raw and effective configuration separately
The Dashboard API SHALL provide distinct revisioned endpoints for redacted raw documents and effective active snapshots.

#### Scenario: Read raw global document
- **WHEN** an authorized operator requests the raw global configuration
- **THEN** the response contains the persisted redacted source document, normalized source path, schema version, and raw revision
- **AND** it excludes environment-resolved secret values

#### Scenario: Read effective configuration
- **WHEN** an authorized operator requests effective configuration
- **THEN** the response contains active snapshot version, desired revision, redacted effective values, field provenance, diagnostics, and pending restart fields

#### Scenario: Read raw Workspace document
- **WHEN** an authorized operator requests a Workspace's raw configuration
- **THEN** the response contains its redacted source document, source path, source fingerprint, schema version, and raw revision

### Requirement: Dashboard supports validation preview before apply
The Dashboard API SHALL compile a proposed global or Workspace document without persisting or activating it and SHALL return actionable diagnostics and an activation plan.

#### Scenario: Valid preview returns effective diff
- **GIVEN** a proposed document and current expected revision
- **WHEN** the operator requests preview
- **THEN** the API returns the redacted effective diff, provenance changes, live changes, restart-required changes, warnings, and no errors
- **AND** active and persisted state remain unchanged

#### Scenario: Invalid preview returns all diagnostics
- **GIVEN** a proposal contains unknown fields, duplicate ids, missing references, or invalid values
- **WHEN** preview compilation runs
- **THEN** the API returns diagnostics with code, severity, source, field path, and message
- **AND** no content is persisted or activated

### Requirement: Dashboard apply uses optimistic concurrency and activation status
The Dashboard API SHALL require an expected raw revision when applying global or Workspace source documents and SHALL report desired and active state separately.

#### Scenario: Apply current revision succeeds
- **GIVEN** preview succeeded for raw revision `R`
- **WHEN** the operator applies the same proposal with expected revision `R`
- **THEN** it is compiled again, persisted atomically, and activation is coordinated
- **AND** the response reports new raw revision, active snapshot version, and pending restart paths

#### Scenario: Apply stale revision fails
- **GIVEN** raw revision changed after an operator previewed revision `R`
- **WHEN** the operator applies with expected revision `R`
- **THEN** the API returns a conflict with the current revision
- **AND** it does not overwrite, persist, or activate the stale proposal
