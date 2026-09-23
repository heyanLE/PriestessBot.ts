## MODIFIED Requirements

### Requirement: Workspace directory resolution
The system SHALL resolve Workspace ids through the global Workspace catalog and SHALL treat the catalog entry as the sole owner of the Workspace directory.

#### Scenario: Explicit registered Workspace is selected
- **GIVEN** message context supplies an enabled Workspace id registered in the active catalog
- **WHEN** Workspace preparation runs
- **THEN** the catalog directory for that id is used
- **AND** message metadata cannot replace the directory

#### Scenario: Selection rules and defaults are deterministic
- **GIVEN** no valid explicit Workspace id is present
- **WHEN** Workspace selection runs
- **THEN** matching catalog rules are evaluated in validated deterministic order
- **AND** platform default Workspace id then global default Workspace id are used as fallbacks
- **AND** the selected source and rule are recorded in pipeline metadata

#### Scenario: Unregistered Workspace is rejected
- **GIVEN** message metadata names an unknown or disabled Workspace id
- **WHEN** Workspace preparation runs
- **THEN** the request fails with a Workspace selection diagnostic
- **AND** no arbitrary message-provided directory is read

### Requirement: Directory-backed workspace snapshots
The system SHALL compile a registered Workspace directory into an immutable active `WorkspaceSnapshot` and SHALL publish changed directory contents only after successful explicit or watched reload.

#### Scenario: Reload publishes current valid directory contents
- **GIVEN** a Workspace directory changes on disk
- **WHEN** its source is reloaded and compilation succeeds
- **THEN** one new Workspace snapshot version is atomically published
- **AND** later messages observe the new version

#### Scenario: Disk change is not read ad hoc per message
- **GIVEN** a Workspace directory changes after version `N` was activated
- **WHEN** a message arrives before a successful reload
- **THEN** the message pins active version `N`
- **AND** pipeline stages do not independently reread Workspace files

#### Scenario: Snapshot remains pinned for the message lifetime
- **GIVEN** a message has pinned Workspace snapshot version `N`
- **WHEN** version `N+1` activates while that message continues processing
- **THEN** the in-flight message continues using version `N`
- **AND** later messages use version `N+1`

### Requirement: Workspace configuration model
The system SHALL define a strict, versioned Workspace behavior document that owns Agent, sub-agent, routing, generation, context, execution, tool, skill, MCP, persona, and memory settings.

#### Scenario: Workspace behavior document is decoded
- **WHEN** a current-schema Workspace document is decoded
- **THEN** it contains id, name, enabled state, primary Agent id, explicit Agent definitions, orchestration, tool policy, skills, MCP servers, personas, and memory policy
- **AND** each Agent contains explicit provider reference, model, generation, context, execution, persona, and tool policy fields

#### Scenario: Workspace cannot configure global infrastructure
- **GIVEN** a Workspace document contains server, database, plugin, platform connection, or provider connection fields
- **WHEN** it is compiled
- **THEN** compilation fails with a wrong-owner diagnostic

#### Scenario: Legacy global behavior requires migration
- **GIVEN** an existing deployment defines Agent or sub-agent behavior only in legacy global config
- **WHEN** the v2 migration tool runs
- **THEN** it proposes an explicit default Workspace behavior document
- **AND** normal strict v2 compilation does not silently synthesize that Workspace

## ADDED Requirements

### Requirement: Workspace inheritance is explicit and deep by schema
The system SHALL prohibit untyped shallow map merging and SHALL apply defaults only through typed schema defaults or an explicitly declared inheritance relation.

#### Scenario: Nested Agent settings retain typed defaults
- **GIVEN** an Agent omits an optional nested setting
- **WHEN** the Workspace is compiled
- **THEN** the field receives its documented typed default
- **AND** unrelated nested defaults are not erased by a partial map replacement

#### Scenario: Undeclared parent merge is rejected
- **GIVEN** a Workspace attempts to inherit fields without an explicit supported parent relation
- **WHEN** it is compiled
- **THEN** the candidate fails rather than applying a shallow merge

### Requirement: Workspace runtime resources are resolved during compilation
The system SHALL resolve skills, MCP tools, personas, tool ids, and Agent references before publishing a Workspace snapshot.

#### Scenario: Required MCP server cannot initialize
- **GIVEN** a Workspace declares a required MCP server
- **WHEN** its client or tool discovery fails during candidate compilation
- **THEN** that Workspace candidate is rejected
- **AND** its previous active snapshot remains available

#### Scenario: Optional MCP server cannot initialize
- **GIVEN** a Workspace declares an optional MCP server
- **WHEN** its client or tool discovery fails
- **THEN** compilation records a warning and contributes no tools from that server
- **AND** the optional failure is visible in Workspace diagnostics
