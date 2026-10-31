# command-permission-controls Specification

## Purpose
TBD - created while syncing archived changes. Update Purpose after archive.


> TypeScript requirements apply to runtime `priestess-ts`. Unmodified Kotlin/workspace-specific requirements below remain reference requirements for the legacy runtime.

## Requirements

### Requirement: Sender permission groups
The system SHALL resolve each accepted sender/session into operator, senior_operator or elite_operator using server-validated grants and state requests. The state SHALL be immutable for an active turn and SHALL not be shared with other group participants.

#### Scenario: Configured higher grant
- **WHEN** a sender has a higher grant and requests a state within it
- **THEN** that state SHALL apply to subsequent turns in that sender/session scope

#### Scenario: Unconfigured sender
- **WHEN** no grant is configured for a sender
- **THEN** the sender SHALL run as operator

### Requirement: Prefix command dispatch
The system SHALL parse trimmed messages that begin with the configured nonempty command prefix and dispatch the command name and arguments to a registered command handler before Agent preprocessing.

#### Scenario: Recognized command bypasses the LLM
- **GIVEN** a registered command named `new` and a message `/new`
- **WHEN** the command stage processes the message
- **THEN** the command handler is invoked
- **AND** no Agent context or LLM request is created for that message
- **AND** the command response is sent through the normal response path

#### Scenario: Non-command message proceeds to Agent preprocessing
- **GIVEN** the command prefix is `/`
- **WHEN** an accepted message does not begin with `/`
- **THEN** the command stage does not handle it
- **AND** the pipeline proceeds to Agent preprocessing

### Requirement: Command authorization
The system SHALL verify a command's required runtime state, capabilities and resource scope before execution and return a direct authorization result on denial.

#### Scenario: Insufficient command permission
- **WHEN** an operator sender invokes a command requiring senior_operator
- **THEN** the handler SHALL not execute and the persona/default denial SHALL be delivered without an LLM request

### Requirement: New conversation command
The built-in new/reset command SHALL require senior_operator or greater plus the conversation-reset capability, preserve business conversation identity, reset active history and invalidate the old engine/session generation.

#### Scenario: Authorized reset
- **WHEN** an authorized sender resets a conversation
- **THEN** the old active history/thread mapping SHALL be detached from subsequent turns
- **AND** late old-generation outputs SHALL not be delivered and the success acknowledgment SHALL not become normal history

#### Scenario: Unauthorized reset
- **WHEN** a sender without the required state/capability invokes reset
- **THEN** history SHALL remain unchanged and the configured denial SHALL be returned

### Requirement: Persona-configured permission-denied wording
The system SHALL persist optional persona permissionDenied wording and use it for command and tool denials associated with the selected Agent.

#### Scenario: Persona supplies denied wording
- **WHEN** the selected Agent's persona has a nonblank denial message
- **THEN** the local denial SHALL use that message

#### Scenario: No persona wording
- **WHEN** no eligible custom wording exists
- **THEN** the system SHALL use a stable default denial
