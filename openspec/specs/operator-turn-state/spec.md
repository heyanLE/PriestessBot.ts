# operator-turn-state Specification

## Purpose
Define the operator-turn-state behavior of the TypeScript PriestessBot runtime.

## Requirements

### Requirement: Three authorized turn states
Every run SHALL carry exactly one runtime state: operator (普通干员态), senior_operator (资深干员态), or elite_operator (高级资深干员态). The server SHALL derive it from trusted sender grants and a valid sender/session request; unspecified identities default to operator.

#### Scenario: Allowed session state switch
- **WHEN** a sender requests a state within their grants in a session
- **THEN** later turns from that sender in that session SHALL use the authorized state

#### Scenario: Unauthorized elevation
- **WHEN** a sender requests a state above their grant
- **THEN** the server SHALL reject the switch and preserve the prior authorized setting

#### Scenario: Group participant isolation
- **WHEN** one group participant changes their requested state
- **THEN** another participant's effective state SHALL remain unaffected

### Requirement: Capability and resource intersection
Effective permissions SHALL intersect sender grants, runtime-state capabilities, Agent restrictions, resource scopes and execution-environment constraints. A routing node MUST NOT grant privileges above sender authorization.

#### Scenario: Highest state lacks resource binding
- **WHEN** an elite_operator run requests an unassigned knowledge library
- **THEN** access SHALL be denied despite the runtime-state rank

### Requirement: Trusted provenance and revocation
State provenance SHALL be traceable and fixed for an active turn. Effects MUST check revocation; model text, node transforms and tool payloads MUST NOT replace trusted identity. Management API authentication SHALL remain independent.

#### Scenario: Grant revoked during execution
- **WHEN** an active run loses authorization before a write
- **THEN** that write SHALL be rejected and the run SHALL receive a typed authorization failure

### Requirement: Child and background permission ceiling
Delegated and background work SHALL inherit the original principal and a permission ceiling no greater than its parent, intersect target restrictions and revalidate authorization before subsequent effects.

#### Scenario: Higher-capability target Agent
- **WHEN** an operator run delegates to an Agent configured with administration tools
- **THEN** the child SHALL not receive administration capability absent from the parent
