## MODIFIED Requirements

### Requirement: Ordered IM route activation
An IM SHALL activate a published versioned route graph. Conditions SHALL have deterministic branch priority, and normal conversation paths SHALL select one independent Agent; handled commands and ignored inputs SHALL terminate explicitly.

#### Scenario: Default routes
- **WHEN** default routing is generated for an Agent
- **THEN** command conditions SHALL precede conversation branches and each branch SHALL select its runtime state explicitly or retain the ordinary default.

#### Scenario: Unmatched group message
- **WHEN** no conversation or command condition matches a group input
- **THEN** the graph SHALL terminate without an Agent or model request.

### Requirement: IM-specific identities and roles
The runtime SHALL derive trustworthy sender, group and session identity from the IM adapter and SHALL obtain execution runtime state from the published graph, independently of message text.

#### Scenario: Different permissions across IMs
- **WHEN** the same sender identifier enters graphs that select different states on two IM instances
- **THEN** executions SHALL use their graph-selected states without cross-IM permission inheritance.
