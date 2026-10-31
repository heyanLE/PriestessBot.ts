## ADDED Requirements

### Requirement: A matched Agent route selects platform tool injection

The route action SHALL optionally specify a tool-injection mode. An omitted value SHALL preserve `MULTI`. An enabled route SHALL be rejected before activation if its target Agent type does not support the selected mode. Command routes SHALL NOT carry a tool-injection setting.

#### Scenario: Existing Agent route
- **WHEN** an Agent route omits `toolInjectionMode`
- **THEN** it retains the previous per-platform-tool behavior

#### Scenario: Route selects no IM tools
- **WHEN** a route selects `NONE`
- **THEN** IM platform tools are absent from that turn's scoped tool set

#### Scenario: Unsupported mode
- **WHEN** a route selects a mode its target Agent cannot run
- **THEN** activation fails naming the route, Agent and mode
