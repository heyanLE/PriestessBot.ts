# agent-presets Specification

## Purpose
TBD - created while syncing archived changes. Update Purpose after archive.

## Requirements

### Requirement: Agent behaviour is selected by preset
The system SHALL give every Agent an explicit preset selection, defaulting to the simple chat preset so that existing Agents keep their current behaviour without migration.

#### Scenario: New Agent defaults to the chat preset
- **WHEN** an Agent is configured without a preset
- **THEN** it SHALL use the simple chat preset

#### Scenario: Presets are independent
- **WHEN** one Agent selects the chat preset and another selects the task preset
- **THEN** each SHALL operate with its own prompt assembly, tool scheduling and compression policy
- **AND** changing one preset's definition SHALL NOT change the other's behaviour

#### Scenario: Unknown preset is rejected
- **WHEN** an Agent selects a preset that is not registered
- **THEN** configuration validation SHALL report an error before the generation is activated

#### Scenario: Preset survives projection and compilation
- **WHEN** an Agent's preset is configured in the v3 document
- **THEN** the compiled runtime Agent SHALL report the same preset

### Requirement: Preset definitions are data
The system SHALL resolve a preset to a definition carrying its display name, description, runner kind, ordered prompt sections, persona template, instruction-document spec, tool-scheduling policy, compression policy and default budgets, so that adding a preset does not require a new branch in the runtime.

#### Scenario: A preset supplies the Agent's defaults
- **WHEN** an Agent is created with a preset and does not state its own budgets
- **THEN** the preset's default step budget and context window SHALL apply

#### Scenario: Explicit Agent values win
- **WHEN** an Agent states its own budget
- **THEN** the preset default SHALL NOT override it

#### Scenario: Preset definitions are inspectable
- **WHEN** the Dashboard offers a preset choice
- **THEN** it SHALL obtain the available presets and their display names and descriptions from the registry rather than from a duplicated list

### Requirement: System prompt is assembled from ordered numbered sections
The system prompt SHALL be assembled from named sections carrying an explicit order, sorted by order and then by name, with sections that render blank omitted and survivors joined by a blank line.

#### Scenario: Sections render in declared order
- **WHEN** a preset declares several sections
- **THEN** the assembled prompt SHALL present them in ascending order value

#### Scenario: Blank sections are omitted
- **WHEN** a declared section has no content for the request
- **THEN** it SHALL contribute no text and no stray heading

#### Scenario: The Agent role document is present
- **WHEN** the task preset assembles a prompt
- **THEN** the Agent's own instructions SHALL appear as their own section

### Requirement: A preset may wrap the prompt in a templated identity
The system SHALL allow a preset to declare prefix and suffix identity sections, interpolating the Agent's model and configuration directory into `{{model}}` and `{{cwd}}` placeholders. This identity wrapper is distinct from the platform persona, which remains part of the Agent's role document.

#### Scenario: Placeholders resolve from the Agent
- **WHEN** an identity template contains `{{model}}` or `{{cwd}}`
- **THEN** the rendered section SHALL contain the Agent's configured model and its resolved configuration directory

#### Scenario: Absent identity template yields no section
- **WHEN** a preset declares no identity template
- **THEN** neither identity section SHALL appear

#### Scenario: Platform persona is unaffected
- **WHEN** an Agent selects a platform persona and a preset with an identity template
- **THEN** the persona content SHALL remain in the Agent's role document and the identity wrapper SHALL appear as its own prefix and suffix sections

### Requirement: An instruction document is loaded from the Agent directory
The system SHALL load the Agent's instruction document from its configuration directory under a configured byte budget, accepting only regular files, rejecting symbolic links, and deduplicating identical documents.

#### Scenario: Document is injected as its own section
- **WHEN** the Agent configuration directory contains an instruction document
- **THEN** its content SHALL appear in the prompt inside a clearly delimited, labelled block naming its source path

#### Scenario: Absent document is not an error
- **WHEN** the Agent configuration directory contains no instruction document
- **THEN** no instruction section SHALL appear and the request SHALL proceed

#### Scenario: Budget overflow is reported, not silent
- **WHEN** the documents exceed the configured byte budget
- **THEN** the injected block SHALL state the budget and what was omitted or truncated

#### Scenario: Embedded delimiters cannot break the block
- **WHEN** document content contains the block's own closing delimiter
- **THEN** it SHALL be escaped so the block cannot be terminated early

#### Scenario: Symbolic links are refused
- **WHEN** the instruction document is a symbolic link or not a regular file
- **THEN** it SHALL be ignored

### Requirement: Tools may contribute prose guidance
The system SHALL allow a tool to declare short behavioural guidance that is rendered as its own prompt section, ordered with read-only tools before mutating tools.

#### Scenario: Guidance appears as a section
- **WHEN** a visible tool declares guidance
- **THEN** the assembled prompt SHALL contain one guidance section for that tool

#### Scenario: Guidance is not a schema restatement
- **WHEN** a tool declares guidance
- **THEN** the tool's JSON schema SHALL still be delivered only as a provider-native function definition

#### Scenario: No guidance means no section
- **WHEN** a visible tool declares no guidance
- **THEN** it SHALL contribute no prompt section

#### Scenario: Guidance follows tool visibility
- **WHEN** a tool is filtered out of the request by permission or policy
- **THEN** its guidance section SHALL NOT appear either
