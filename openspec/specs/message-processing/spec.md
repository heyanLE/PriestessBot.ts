# message-processing Specification

## Purpose
Define the message-processing behavior of the TypeScript PriestessBot runtime.

## Requirements

### Requirement: Source-labeled message context
The information processing layer SHALL normalize trusted platform identity separately from untrusted text, names, quotations, attachments and public group history. It SHALL render message_meta, quoted_message, group_history and speaker_change context in the AstrBotX-style format.

#### Scenario: Group speaker changes
- **WHEN** another participant sends the next accepted message
- **THEN** context SHALL identify the current sender and label previous chatter as reference rather than a new instruction

### Requirement: Typed conversation identity and history reservation
Session ownership and history keys SHALL include platform instance, private/group session type and session ID. Group history SHALL be bounded, reserved once for a run and restored after failures; rejected messages and processed commands SHALL not reappear as actionable history.

#### Scenario: Private and group IDs collide
- **WHEN** a QQ user and group share the same numeric ID
- **THEN** their model history, authorization, memory and reset generations SHALL remain isolated

#### Scenario: Cancelled processing
- **WHEN** a run cannot consume its reserved public context
- **THEN** eligible reference messages SHALL be restored without duplicating the triggering request

### Requirement: Bounded media and platform presentation
The layer SHALL validate whole-turn media size and extraction budgets, preserve file provenance, format supported Markdown per platform, paginate long output and serialize streamed edits. Every actual send/edit MUST recheck the current run's authorization or cancellation guard.

#### Scenario: Cancelled stream with queued edits
- **WHEN** authorization is revoked while an earlier send is waiting
- **THEN** later queued edits SHALL not be sent after that send completes

#### Scenario: Explicit versus uncertain delivery failure
- **WHEN** a platform definitively rejects an edit
- **THEN** delivery SHALL use the configured bounded final-message fallback
- **AND** an uncertain send SHALL not be blindly repeated
