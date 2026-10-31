## MODIFIED Requirements

### Requirement: Sender permission groups
The system SHALL use route-selected 普通干员态, 资深干员态 and 高级资深干员态 as ordered execution states. Legacy role lists SHALL be translated into explicit route conditions and state-selection nodes during migration.

#### Scenario: Configured super administrator wins
- **WHEN** a migrated sender appears in both legacy administrative lists
- **THEN** the generated graph SHALL select 高级资深干员态 before matching the lower-state branch.

#### Scenario: Unconfigured sender is an operator
- **WHEN** a migrated sender matches neither legacy list and no other state rule
- **THEN** the generated graph SHALL retain 普通干员态.

### Requirement: Prefix command dispatch
A graph Command node SHALL parse trimmed prefixed input, dispatch registered names and typed arguments, and expose handled, unhandled and error outcomes.

#### Scenario: Recognized command bypasses the LLM
- **WHEN** a Command node handles a registered new command
- **THEN** its normal reply path SHALL execute without an Agent request.

#### Scenario: Non-command message proceeds to Agent preprocessing
- **WHEN** input does not match the command prefix
- **THEN** the unhandled graph edge SHALL continue toward its configured Agent path.

### Requirement: Command authorization
Commands SHALL enforce declared capabilities and minimum runtime state before execution and SHALL use persona-configured denial wording or a stable default.

#### Scenario: Insufficient command permission
- **WHEN** a command requires 资深干员态 and the graph supplies 普通干员态
- **THEN** no handler or model request SHALL execute and an authorization reply SHALL be returned.

### Requirement: New conversation command
The built-in new command SHALL require at least 资深干员态, clear the current IM/session/Agent conversation history and release the corresponding engine thread while preserving conversation identity.

#### Scenario: Administrator starts a new conversation
- **WHEN** an authorized run executes new
- **THEN** history SHALL be reset, the prior thread SHALL be released, conversation identity SHALL remain and the success reply SHALL not enter conversation history.

#### Scenario: Operator cannot start a new conversation
- **WHEN** 普通干员态 executes new without the required capability
- **THEN** history SHALL remain unchanged and the configured denial reply SHALL be returned.
