## ADDED Requirements

### Requirement: Platforms declare scoped tools
The system SHALL let each registered Platform declare known tool schemas and SHALL expose executable instances only for messages handled by that Platform.

#### Scenario: NapCat message receives NapCat tools
- **WHEN** a NapCat message enters PreProcess with an effective Agent that allows NapCat tool IDs
- **THEN** the Agent prompt and executor contain the allowed NapCat tools

#### Scenario: Other Platform does not receive NapCat tools
- **WHEN** a Telegram or Weixin message uses the same Workspace and Agent
- **THEN** NapCat executable tools are absent from both the prompt and executor

### Requirement: Platform tools use current message context
Platform-native tools SHALL use the pinned current Platform, session, sender permission, and message metadata and SHALL reject missing or incompatible context.

#### Scenario: Group-only action in private session
- **WHEN** a group-file or mention tool is called from a private session
- **THEN** execution fails with a structured context error
- **AND** no Platform API call occurs

#### Scenario: Quotation follows inbound context
- **WHEN** an inbound message references another message
- **THEN** the application carries that reference into the final reply
- **AND** no model tool can select a quotation target or send an intermediate response

### Requirement: Dangerous Platform tools require explicit enablement
Default-disabled Platform tools SHALL remain absent when Workspace and Agent allowlists are empty and SHALL become eligible only through an explicit named allow that also passes risk and permission policy.

#### Scenario: File deletion is not implicitly enabled
- **GIVEN** a Workspace tool policy has an empty allowlist
- **WHEN** effective tools are compiled
- **THEN** the default-disabled NapCat delete and folder mutation tools are absent

#### Scenario: Senior operator explicitly enables deletion
- **GIVEN** the Workspace explicitly allows a NapCat delete tool
- **AND** the sender has senior-operator (`ADMIN`) permission and the risk level is allowed
- **WHEN** the Agent context is built
- **THEN** the delete tool is advertised and executable

### Requirement: Group-file reads and writes have distinct permission levels
NapCat group-file read tools SHALL require ordinary-operator (`OPERATOR`) permission, while every upload, delete, create-folder, or delete-folder tool SHALL require senior-operator (`ADMIN`) permission.

#### Scenario: Ordinary operator reads group files
- **GIVEN** the sender resolves to ordinary-operator (`OPERATOR`) permission
- **WHEN** the Agent uses group-file listing or group-file URL resolution
- **THEN** the read tool is advertised and executable

#### Scenario: Ordinary operator cannot write group files
- **GIVEN** a group-file write tool is explicitly enabled
- **AND** the sender resolves to ordinary-operator (`OPERATOR`) permission
- **WHEN** the Agent context is built
- **THEN** the write tool is absent
- **AND** direct execution is denied before any NapCat API call

#### Scenario: Senior operator writes group files
- **GIVEN** a group-file write tool is explicitly enabled and its risk level is allowed
- **AND** the sender resolves to senior-operator (`ADMIN`) or higher permission
- **WHEN** the Agent invokes the write tool
- **THEN** the action is eligible for execution against the current session

### Requirement: NapCat native messaging and file tools
NapCat SHALL contribute typed tools for final-response current-group mention marks, received-file inspection, group-file listing, group-file URL resolution, URL file upload, group-file deletion, and group-folder creation/deletion.

#### Scenario: Final reply includes OneBot reply segment
- **WHEN** the final response is assembled for an inbound message containing a quotation
- **THEN** the chain starts with a reply segment for the referenced message ID
- **AND** regular unquoted input does not gain a reply segment

#### Scenario: Mention stays in current group
- **WHEN** `napcat_mention_user` executes in a group session
- **THEN** the tool records a deduplicated mention for the current run and sends no message
- **AND** final assembly places the at segment before the final body in the current group
- **AND** the tool accepts no response text

#### Scenario: List group files
- **WHEN** `napcat_list_group_files` executes in a group session
- **THEN** it returns the sanitized OneBot file/folder listing for the current group

#### Scenario: Upload URL as session file
- **WHEN** an authorized Agent explicitly invokes the enabled upload tool with an HTTP(S) URL
- **THEN** the tool records an attachment for delivery after the final response
- **AND** non-HTTP(S) values are rejected before recording an attachment
- **AND** only final delivery uploads it to the current private or group session

#### Scenario: Destructive group action
- **WHEN** an authorized Agent invokes an explicitly enabled delete-file or delete-folder tool
- **THEN** the action targets only the current group
- **AND** the result is audit-visible

### Requirement: Inbound NapCat attachments are structured
The NapCat parser SHALL preserve message IDs and structured OneBot or CQ at/file/image/reply segments in the unified message event without logging attachment URLs.

#### Scenario: File message is received
- **WHEN** NapCat receives a CQ file segment
- **THEN** the `MessageChain` contains a `File` component with its name and available URL
- **AND** the current-file inspection tool can return it to the Agent

#### Scenario: Message ID is available for reply
- **WHEN** NapCat parses an inbound OneBot message with `message_id`
- **THEN** `MessageEvent.messageId` contains that ID
