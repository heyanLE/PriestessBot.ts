## ADDED Requirements

### Requirement: Scoped execution environments
Execution backends SHALL report their actual isolation and supported operations. Files, processes, PTYs and artifacts MUST be bound to principal, Agent, session and run ownership with authorization on every operation.

#### Scenario: Another run's terminal
- **WHEN** an unauthorized run attempts to list, read, write or kill another terminal session
- **THEN** the operation SHALL fail without exposing its contents

#### Scenario: Native engine capability bypass
- **WHEN** a native engine operation cannot be constrained to the effective run policy
- **THEN** that capability SHALL remain unavailable for the run

### Requirement: Background completion scheduling
Background completion SHALL enter the common scheduler with a deduplication identity, original ownership and permission ceiling. Cancellation, reset and revocation MUST be checked before continuation.

#### Scenario: Duplicate completion notification
- **WHEN** two notifications identify the same background completion
- **THEN** at most one continuation SHALL be scheduled

### Requirement: Authorized Skills and MCP
Skills SHALL support authorized catalog/body/reference access and explicit named-skill use. MCP tools SHALL be validated at the boundary and checked against current authorization at execution.

#### Scenario: Skill reference traversal
- **WHEN** a skill reference resolves outside its authorized resource root
- **THEN** the read SHALL be rejected

### Requirement: Authoritative scoped long-term memory
MemoryService SHALL manage persistent scoped memories, provenance, extraction/consolidation, retrieval, editing, expiration and deletion. All access MUST respect Agent library selection and current principal; automatic extraction MUST NOT promote mixed group content into a shared global library.

#### Scenario: User-specific memory in a group
- **WHEN** another group participant triggers recall
- **THEN** the first participant's private memories SHALL not be injected

#### Scenario: Delete memory
- **WHEN** an authorized memory deletion succeeds
- **THEN** future recall and active retrieval indexes/caches SHALL exclude it, with retained transcript behavior explicitly documented

### Requirement: Non-audio media pipeline
Text, image and file inputs and outputs SHALL use validated, owned media references. Files SHALL preserve extraction provenance; content MUST NOT be promoted to trusted instructions. Audio and voice SHALL be explicitly unsupported in this release.

#### Scenario: Image into Agents SDK
- **WHEN** an authorized valid image is accepted
- **THEN** the SDK adapter SHALL convert the authorized media reference into image content accepted by the selected model rather than a textual image placeholder

#### Scenario: File exceeds limits
- **WHEN** a file exceeds configured size or parsing budgets
- **THEN** processing SHALL return a typed user-visible limit result without silently discarding the file

### Requirement: Conversation and shared workspace zones
File tools SHALL accept relative isolated paths and the canonical /workspace/files and /workspace/shared aliases. Isolated files SHALL be scoped by platform, conversation type, conversation, Agent generation owner and reset generation. Shared files SHALL be scoped by assigned execution environment. Shared writes SHALL require elite_operator plus current resources.manage and files.write authorization. Docker SHALL mount shared storage read-only for lower states.

#### Scenario: Senior writes shared file
- **WHEN** a senior operator tries to write a shared file, including through a file alias
- **THEN** the API SHALL reject the mutation and the shared Docker mount SHALL remain read-only

### Requirement: Workspace skill management
The runtime SHALL discover skills under .agent/skill in both workspace zones. Skill tools SHALL list, read, create, replace and delete individual skill files. New SKILL.md metadata SHALL be validated. Persona skill allowlists and live authorization SHALL apply to every operation. Assigned legacy libraries SHALL remain read-only. Administrative startup SHALL install the packaged skill-packager without replacing valid operator edits.

#### Scenario: A valid skill is created
- **WHEN** an authorized writer creates a valid skill-name/SKILL.md through write_skill
- **THEN** list_skills SHALL immediately expose the library and exact read path without a service restart
