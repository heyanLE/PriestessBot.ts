# typed-command-definition Specification

## Purpose
Define the typed-command-definition behavior of the TypeScript PriestessBot runtime.

## Requirements

### Requirement: Code-defined command contract
Commands SHALL define a name, optional aliases, typed argument schema, authorization requirements, execute handler and reply mapping in TypeScript. Production command handlers MUST NOT be authored through uploaded scripts or Dashboard JSON.

#### Scenario: Conflicting alias
- **WHEN** two commands register the same name or alias
- **THEN** registration SHALL fail with a diagnostic identifying both definitions

### Requirement: Parsed arguments and typed outcomes
Argument parsing SHALL support required/optional fields, quoting, escapes, scalar/enum validation and trailing text. Execution SHALL receive the schema-derived type and return a discriminated handled/unhandled/rejected/failed result.

#### Scenario: Invalid recognized command
- **WHEN** a recognized command receives invalid arguments
- **THEN** its handler SHALL not run and a usage reply SHALL be returned without an LLM request

### Requirement: Execution and reply separation
Command replies SHALL be typed message plans sent by the common delivery service. A failed reply MUST NOT cause command effects to execute again.

#### Scenario: Reply fails after reset
- **WHEN** a reset succeeds but its acknowledgment fails to send
- **THEN** delivery handling SHALL not rerun the reset handler

### Requirement: Lifecycle control commands
Help, new/reset, stop and state inspection/switch SHALL use the shared command contract. Reset and cancellation controls MUST invalidate stale generations and stop MUST bypass the active-turn queue.

#### Scenario: Reset races with final output
- **WHEN** an authorized reset invalidates a conversation generation before an old turn completes
- **THEN** that completion SHALL not be delivered into the new generation
