## ADDED Requirements

### Requirement: Code-defined command contract
Each command SHALL define a unique name, optional aliases, typed argument schema, required capabilities, execution handler and structured reply outcome. Registration SHALL be implemented in Rust code.

#### Scenario: Duplicate alias
- **WHEN** two registered commands share a name or alias
- **THEN** registration SHALL fail with a conflict diagnostic.

### Requirement: Parse before execution
The dispatcher SHALL validate required arguments, types, quoting and escaping before invoking a handler.

#### Scenario: Invalid argument
- **WHEN** a recognized command has a missing or invalid argument
- **THEN** the handler SHALL NOT run and the reply SHALL explain the expected usage.

### Requirement: Execution and reply separation
Command execution SHALL produce handled, unhandled or error outcomes and optional unified message replies. Reply delivery SHALL NOT implicitly rerun command side effects.

#### Scenario: Reply failure after execution
- **WHEN** a successful command's reply cannot be delivered
- **THEN** delivery failure SHALL be tracked separately and the handler SHALL NOT automatically execute again.

### Requirement: Prompt cancellation control
Cancellation commands SHALL reach the running session without waiting behind its active turn.

#### Scenario: Stop during a long tool
- **WHEN** an authorized stop command targets an active turn
- **THEN** cancellation SHALL propagate to that turn and its child tasks without first obtaining its queued-turn execution slot.


### Requirement: Persistent session control targets
The persistent command registry SHALL provide new, reset and stop, targeting only the Agent selected for commands by the trusted graph and the current IM/session identity. New and reset SHALL be aliases requiring at least senior state and execution capability.

#### Scenario: Reset during a native turn
- **WHEN** an authorized reset occurs while a turn is active
- **THEN** the active work SHALL be cancelled, the session generation SHALL advance, visible history and its rollout mapping SHALL be cleared, and late or previously queued work SHALL NOT repopulate the reset session.
- **AND** the persistent session identity SHALL remain unchanged and the control reply SHALL NOT enter model history.

#### Scenario: Stop another sender
- **WHEN** an ordinary-state sender tries to stop another sender's active turn
- **THEN** the command SHALL be denied; a senior sender with execution capability SHALL be able to stop that turn within the same session and Agent target.

#### Scenario: Continue after clean stop
- **WHEN** a turn is cleanly interrupted with stop and a later message arrives
- **THEN** completed history and the resumable engine thread SHALL remain available.
