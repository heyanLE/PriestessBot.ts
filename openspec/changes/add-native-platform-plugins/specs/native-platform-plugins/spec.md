## ADDED Requirements

### Requirement: Effective prompt source
The Agent configuration SHALL identify the bound persona and effective examples, provide an explicit persona selector, and separate advanced supplemental instructions from the persona library.
#### Scenario: Bound persona is edited
- **WHEN** an Agent uses a library persona
- **THEN** the editor shows that source and directs persona edits to the library, without offering an overridden inline field as if it were active.

### Requirement: Scoped NapCat tools
The runtime SHALL expose typed group-file, album, member and announcement operations, including pagination, metadata, links, uploads and authorized mutations.
#### Scenario: Cross-group mutation
- **WHEN** an ordinary sender requests a different group's write operation
- **THEN** the runtime rejects it before calling NapCat; authorized current-group operations still obey capability and tool bindings.

### Requirement: Configurable search
The runtime SHALL provide independently configured search/fetch tools with normalized citations, bounded results, secret references and provider diagnostics.
#### Scenario: Disabled or unconfigured provider
- **WHEN** search is disabled or lacks its configured credential
- **THEN** tools are unavailable or return a specific safe configuration error without leaking credentials or claiming search success.

### Requirement: Managed native plugin lifecycle
The Dashboard SHALL list the five requested native plugins with source attribution, typed configuration, enable/disable/reload, status, tools/commands and jobs. Runtime hooks SHALL honor disable/revocation, original identity and delivery deduplication.
#### Scenario: Plugin disabled during work
- **WHEN** a plugin is disabled while processing
- **THEN** subsequent tool effects and deliveries are prevented and its job reports cancellation or failure honestly.

### Requirement: Requested plugin behaviors
Native implementations SHALL provide QQ file assistance, Markdown cleanup/rendering, Bilibili lookup/content/summary and subscription workflows, Bangumi lookup/calendar/collection/subscription workflows, and scoped local reminiscence event/reflection/topic/node workflows. Unsupported upstream operations and external prerequisites SHALL be explicitly documented and visible.
#### Scenario: External content unavailable
- **WHEN** account rights, subtitles, ASR, model files or rendering dependencies are unavailable
- **THEN** the plugin reports the exact unavailable capability or applies its configured fallback without fabricating content.

### Requirement: Scoped reminiscence
Daily summaries, events, reflections, topics, node recall and embeddings SHALL retain source conversation and sender scope, support maintenance, and prevent private-to-group promotion.
#### Scenario: Daily boundary
- **WHEN** an enabled daily policy reaches its configured timezone boundary
- **THEN** each authorized scope is processed once, progress persists, and disabled session reset or push options remain inactive.
