## MODIFIED Requirements

### Requirement: Internal loops are selected only for internal Agent types

The internal Agent runner SHALL derive its prompt preset from the registered Agent type. It SHALL reject an external type rather than running that type through a `ChatProvider`.

#### Scenario: CODEX reaches the internal facade
- **WHEN** an external Agent is accidentally passed to the internal loop
- **THEN** the facade rejects the call before any model request
