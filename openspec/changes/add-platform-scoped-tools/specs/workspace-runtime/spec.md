## ADDED Requirements

### Requirement: Workspace validation recognizes Platform tool declarations
Workspace compilation SHALL validate named tool policies against registered built-in, plugin, MCP, and Platform-contributed tool declarations.

#### Scenario: Known Platform tool is explicitly allowed
- **WHEN** a Workspace allowlist names a registered NapCat tool
- **THEN** strict reference validation accepts the ID

#### Scenario: Unknown Platform-like tool is rejected
- **WHEN** a Workspace policy names an unregistered platform tool ID
- **THEN** compilation fails with an unknown-tool diagnostic

### Requirement: Default-disabled tools require named allow
Workspace tool resolution SHALL start from default-enabled tools when no allowlist is authored and SHALL permit a known default-disabled tool only when a non-empty allowlist names it.

#### Scenario: Empty allowlist uses safe defaults
- **WHEN** a Workspace and Agent omit named allows
- **THEN** default-enabled tools remain eligible
- **AND** default-disabled tools remain absent

#### Scenario: Explicit allow opts into default-disabled tool
- **WHEN** a Workspace allowlist names a known default-disabled tool
- **THEN** that tool becomes eligible for subsequent Agent, risk, permission, and current-Platform intersection
