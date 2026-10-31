## ADDED Requirements

### Requirement: An Agent type declares what the Agent can do

The system SHALL describe every Agent by a registered type rather than by a behaviour preset. A type SHALL resolve to a data-driven descriptor carrying the engine that runs the Agent's loop, the internal preset where that engine is internal, the set of LLM wire protocols the Agent accepts, the set of tool-injection modes the Agent accepts, and the default budgets. The configuration surface SHALL expose exactly one selection field for it. A type whose engine is internal SHALL declare an internal preset; a type whose engine is external SHALL NOT be required to.

#### Scenario: Existing Agents keep their behaviour
- **WHEN** an Agent configured before this model is loaded
- **THEN** it SHALL resolve to the type of the same name
- **AND** it SHALL dispatch to the same loop and produce the same result as before

#### Scenario: Type selection is explicit and data-driven
- **WHEN** an Agent selects a registered type
- **THEN** its compiled runtime SHALL carry that type and its declared capabilities
- **AND** an unregistered type SHALL fail validation without replacing the active generation

#### Scenario: A new type is data, not a branch
- **WHEN** a new type is registered
- **THEN** it SHALL declare its engine, accepted protocols, accepted injection modes and default budgets without requiring a new branch in the runtime

#### Scenario: Internal-only settings are reported rather than ignored
- **WHEN** an Agent of an external-engine type carries prompt, compression or budget settings the engine does not consume
- **THEN** validation SHALL report those settings as inert for that type
- **AND** it SHALL NOT silently discard them

### Requirement: Agent capability is declared as a set and enforced at activation

An Agent type SHALL declare its accepted LLM wire protocols and accepted tool-injection modes as sets. The system SHALL reject, before activation, any configuration that selects a protocol or an injection mode outside the target type's declared sets, naming the Agent, the route where applicable, and the offending value. A capability declared by a type SHALL be treated as an intent, and an external engine SHALL validate that intent against the loaded native engine it actually uses.

#### Scenario: Unsupported protocol is rejected
- **WHEN** an Agent references a connection whose wire protocol is not in its type's accepted protocol set
- **THEN** activation SHALL fail naming the Agent, the connection and the protocol
- **AND** the previously active generation SHALL remain in effect

#### Scenario: Unsupported injection mode is rejected
- **WHEN** a route selects an injection mode outside the target Agent type's accepted modes
- **THEN** activation SHALL fail naming the route, the Agent and the mode

#### Scenario: A declared capability is not proof
- **WHEN** an Agent type declares an injection mode that depends on a mechanism the loaded native engine does not provide
- **THEN** the engine SHALL detect the mismatch when it starts and fail with an actionable message
- **AND** it SHALL NOT accept the configuration claim as sufficient

#### Scenario: Every registered type declares its protocols
- **WHEN** the type registry is constructed
- **THEN** a type that declares no protocol SHALL be a construction error rather than a runtime failure

### Requirement: A provider connection declares a wire protocol separate from its vendor family

The system SHALL keep the vendor or adapter family and the wire protocol as separate selections on a provider connection. The vendor family SHALL supply the default protocol and the endpoint and authentication semantics. The protocol SHALL be selected from a closed set that distinguishes protocols rather than treating one protocol family as a mode of another. Every existing connection SHALL keep its current behaviour without configuration change.

#### Scenario: Existing connections are unaffected
- **WHEN** a connection omits the protocol selection
- **THEN** it SHALL resolve to its vendor family's default protocol
- **AND** it SHALL behave exactly as it does today

#### Scenario: A protocol that is not the vendor default is expressible
- **WHEN** a connection selects a protocol other than its vendor family's default
- **THEN** the resolved protocol SHALL be carried into runtime configuration and reported on the connection view

#### Scenario: Unknown protocol is rejected
- **WHEN** a connection selects an unrecognized protocol
- **THEN** activation SHALL fail naming the connection and the value

#### Scenario: Declared does not mean verified
- **WHEN** a connection is configured for a protocol its endpoint does not implement
- **THEN** the configuration SHALL remain valid and the declared protocol SHALL be reported
- **AND** documentation SHALL state that connectivity testing does not prove the protocol

### Requirement: A wire protocol has one internal consumer and one external consumer

The system SHALL allow a connection's protocol to be consumed either by the internal loop through the chat-provider abstraction or by an external engine that speaks the protocol itself. An internal Agent SHALL require a resolvable chat provider; an Agent whose engine is external SHALL NOT require one and SHALL require only that the referenced connection resolves and its protocol is accepted by the Agent type.

#### Scenario: Internal Agent still requires a chat provider
- **WHEN** an internal Agent's referenced connection cannot produce a chat provider
- **THEN** the run SHALL fail as it does today

#### Scenario: External Agent does not require a chat provider
- **WHEN** an external-engine Agent's referenced connection resolves to an endpoint, a protocol and a credential
- **THEN** the run SHALL proceed to the engine without building a chat provider

#### Scenario: A secret reaches an engine through exactly one path
- **WHEN** an external engine needs the connection's credential
- **THEN** it SHALL receive it through a single audited resolution path at process start
- **AND** the secret SHALL NOT appear in engine configuration files, logs, or any API model

### Requirement: External-engine turns preserve conversation ownership and caller authorization

An external Agent SHALL use isolated, persistent engine state for that Agent and SHALL map each `(workspaceId, agentId, platformId, sessionId)` conversation to its own engine thread. It SHALL resume that thread instead of replaying the local transcript. Concurrent messages for one thread SHALL be serialized. Each server-initiated tool or approval request SHALL be tied to the live originating turn and its caller permission, and an unknown or stale request SHALL fail closed.

#### Scenario: Codex is packaged with the existing application
- **WHEN** an Agent selects the CODEX engine
- **THEN** PriestessBot SHALL load the pinned Codex JNI library and call the Rust engine in process
- **AND** it SHALL NOT require a second network service or exposed port

#### Scenario: A conversation continues in its engine thread
- **WHEN** a later message enters the same Agent and IM session
- **THEN** the external engine SHALL resume that conversation's thread
- **AND** it SHALL NOT replay previously processed messages or tool calls

#### Scenario: Tool requests arrive during an active turn
- **WHEN** the engine requests a dynamic tool before the turn completes
- **THEN** the host SHALL dispatch it using the originating turn's filtered tools and permission group
- **AND** the host SHALL respond without waiting for the turn to complete first

#### Scenario: A route or caller changes the allowed tools
- **WHEN** a later turn for a stored engine thread has a different route-scoped or permission-scoped tool set
- **THEN** the host SHALL update the thread's advertised tools if the pinned engine supports it, or rotate to a new thread with an explicit continuity diagnostic
- **AND** the host SHALL NOT advertise or execute a broader tool set retained from an earlier turn

#### Scenario: A native engine turn fails before completion
- **WHEN** the native engine reports a terminal error or shuts down before the turn completes
- **THEN** the host SHALL fail that turn and release its pending requests
- **AND** it SHALL NOT automatically replay a turn that may already have produced side effects

#### Scenario: The Agent's provider credential changes
- **WHEN** a new effective configuration changes the provider endpoint, protocol or resolved credential used by an external Agent
- **THEN** later turns SHALL use a newly configured native engine generation
- **AND** the host SHALL NOT keep assigning work to a generation carrying the previous credential

#### Scenario: Agent instructions change after a thread starts
- **WHEN** the effective instructions or persona change while a conversation has an engine thread
- **THEN** the next turn SHALL use the new instructions through a supported thread-level update or a new thread with an explicit continuity diagnostic
- **AND** it SHALL NOT silently retain stale instructions or add a duplicate prompt to every user turn

### Requirement: Tool injection is decided per IM route and scoped to its platform

The system SHALL select the tool-injection shape on the IM route that selected the Agent, because injection originates from the platform message. The system SHALL offer a closed vocabulary of shapes: none, one dispatcher tool per platform, one tool per platform capability, and a skill document loaded on demand. The runtime SHALL NOT advertise every registered platform's tools as configurable to every deployment.

#### Scenario: Injection requires an incoming platform message
- **WHEN** a route never reaches an Agent, or no platform message matched a route
- **THEN** no platform tool SHALL be injected

#### Scenario: Two routes on one connection inject differently
- **WHEN** two routes on the same IM connection target Agents with different injection selections
- **THEN** each run SHALL use the shape selected by its own route
- **AND** the decision SHALL NOT be cached on the Agent

#### Scenario: The single-dispatcher shape is owned by the platform
- **WHEN** a route selects one dispatcher tool per platform
- **THEN** the platform SHALL expose exactly one tool for the run
- **AND** the platform SHALL own the mapping from an action to its implementation

#### Scenario: Dispatcher argument validation is not lost
- **WHEN** a dispatcher tool receives arguments that do not satisfy the selected action's required parameters
- **THEN** it SHALL return a structured validation error
- **AND** the failure SHALL be attributable to the action rather than to the dispatcher as a whole

#### Scenario: Dispatcher action permission can be narrowed
- **WHEN** a deployment narrows the permission of one action served by a dispatcher
- **THEN** the narrowing SHALL apply to that action alone
- **AND** it SHALL NOT change the permission class of the platform's other actions

#### Scenario: Existing routes keep the current shape
- **WHEN** a route omits the injection selection
- **THEN** it SHALL behave as it does today

### Requirement: A tool library holds per-tool settings and the Agent may override them

The system SHALL hold tool configuration in a library whose entries carry an enable state, settings values, and credential references. A credential SHALL be expressed as a reference and SHALL NOT be persisted as a plaintext value. An Agent MAY override a library entry's settings field-wise; the Agent's value SHALL win for the fields it sets and the library's value SHALL apply to the rest. The Dashboard SHALL offer restoring a library default. The system SHALL make a tool's configurable settings discoverable so the configuration surface can render them.

#### Scenario: Library default applies unless overridden
- **WHEN** an Agent overrides some but not all of a tool's settings
- **THEN** the Agent's values SHALL apply to the fields it set
- **AND** the library's values SHALL apply to the remaining fields

#### Scenario: Settings change takes effect on the next run
- **WHEN** a library setting or an Agent override changes
- **THEN** the compiled snapshot for subsequent runs SHALL carry the merged values
- **AND** an in-flight run SHALL keep the values it started with

#### Scenario: Credentials are referenced, not stored
- **WHEN** a tool requires a credential
- **THEN** the library entry SHALL hold a credential reference
- **AND** the plaintext value SHALL NOT be written to configuration or exposed by any API model

#### Scenario: Per-Agent credential override is not available
- **WHEN** an Agent attempts to override a library credential
- **THEN** the system SHALL NOT accept it in this model
- **AND** any later change that adds it SHALL reuse the same credential reference type

### Requirement: An external engine's own capabilities keep precedence and their boundary is disclosed

The system SHALL NOT model, suppress or gate an external engine's native tools. Where a tool this runtime injects collides by name with an engine-native tool, or overlaps one in capability, the system SHALL make the consequence explicit rather than leaving it implicit.

#### Scenario: Name collision is a configuration error
- **WHEN** an injected tool's name collides with an engine-native tool
- **THEN** activation SHALL fail naming both
- **AND** the injected tool SHALL NOT remain as unreachable configuration

#### Scenario: Overlap is reported
- **WHEN** an Agent bound to an external engine is configured with injected tools whose capability overlaps an engine-native tool
- **THEN** the configuration surface SHALL report the overlap
- **AND** operator documentation SHALL state that the engine-native action is outside the runtime's tool policy, risk levels and permission groups

#### Scenario: Native tools are absent from runtime-owned surfaces
- **WHEN** an engine's native tools are considered
- **THEN** they SHALL NOT appear in the tool library, in tool listing, or in tool policy switches
- **AND** they SHALL be configured, if at all, through the engine's own settings

### Requirement: Capability rosters and matrices are server-reported

The system SHALL report from the server the roster of Agent types with their accepted protocols and injection modes, each connection's declared protocol, and each platform's available actions and supported injection shapes. The configuration surface SHALL derive its filtering and warnings from that data.

#### Scenario: The surface does not duplicate the matrix
- **WHEN** a new Agent type, protocol or injection shape is registered
- **THEN** the configuration surface SHALL reflect it without a matching frontend change

#### Scenario: Impossible selections are not offered
- **WHEN** an Agent type accepts only a subset of protocols or injection modes
- **THEN** the surface SHALL offer only that subset for Agents and routes of that type
