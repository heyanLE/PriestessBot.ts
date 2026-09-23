## ADDED Requirements

### Requirement: Weixin platform configuration and registration
The system SHALL register a built-in `weixin` platform for personal WeChat iLink accounts and SHALL require a non-blank bot token and account ID from either configured credentials or a previously confirmed QR login before starting it.

#### Scenario: Valid Weixin instance is created
- **WHEN** an enabled `PlatformConfig` has type `weixin`, a non-blank `token`, and `config.accountId`
- **THEN** the registry creates a Weixin adapter whose runtime name matches the configured instance name

#### Scenario: Missing credential prevents startup
- **WHEN** the Weixin adapter starts without a bot token or account ID
- **THEN** startup fails before polling with an error that identifies the missing setting

### Requirement: Dashboard QR login
The system SHALL let an authenticated Dashboard operator start, observe, and cancel an iLink QR-login session for a configured Weixin platform without exposing the confirmed bot token to the browser.

#### Scenario: Operator receives a scannable QR code
- **WHEN** the operator starts QR login for a configured `weixin` platform
- **THEN** the system requests a code using iLink bot type `3`
- **AND** returns a locally rendered QR image encoding `qrcode_img_content`

#### Scenario: Scan waits for phone confirmation
- **WHEN** iLink reports `scaned`
- **THEN** the Dashboard reports that the code was scanned and continues waiting for confirmation

#### Scenario: Confirmation activates the platform
- **WHEN** iLink reports `confirmed` with a complete account ID, bot token, and valid base URL
- **THEN** the system atomically saves the credential outside versioned configuration and configuration backups
- **AND** restarts the selected platform using that credential
- **AND** the bot token is absent from the API response and logs

#### Scenario: QR session is cancelled
- **WHEN** the operator cancels an active QR session
- **THEN** the remote client is closed and later status requests report the session as cancelled or absent

### Requirement: QR expiry and redirect safety
The QR flow MUST use a monotonic overall deadline, bounded refresh, and validated iLink redirect origins.

#### Scenario: Expired code refreshes safely
- **WHEN** iLink reports `expired` fewer than four times before the overall deadline
- **THEN** the system requests a replacement from the canonical endpoint, resets the status origin, and returns the new QR image

#### Scenario: Repeated expiry terminates login
- **WHEN** a fourth QR code expires
- **THEN** the session fails and closes its network client without requesting another code

#### Scenario: Valid redirect changes status origin
- **WHEN** iLink reports `scaned_but_redirect` with an HTTPS-compatible host under `weixin.qq.com`
- **THEN** subsequent status requests use that origin with the same opaque QR token

#### Scenario: Unsafe redirect is rejected
- **WHEN** iLink provides a redirect or confirmed base URL outside the allowed HTTPS iLink origin rules
- **THEN** the session fails without requesting the unsafe origin or persisting credentials

### Requirement: iLink request contract
The adapter MUST send iLink requests to the configured HTTPS base URL with the required application, client-version, authorization-type, randomized WeChat UIN, bearer-token, and JSON content headers.

#### Scenario: Long poll uses the saved cursor
- **WHEN** the adapter requests updates after loading durable state
- **THEN** it posts the saved `get_updates_buf` and protocol `base_info` to the iLink `getupdates` endpoint

#### Scenario: Secret-safe diagnostics
- **WHEN** an iLink request or response fails
- **THEN** logs and surfaced error messages omit the bearer token and peer context tokens

### Requirement: Inbound Weixin text mapping
The adapter SHALL convert supported iLink text messages into unified events and SHALL expose the true sender independently from the chat session.

#### Scenario: Direct text becomes a private event
- **WHEN** iLink returns a text message from another user without a room identifier
- **THEN** the adapter commits a `MessageEvent` with a private session whose ID is the sender ID
- **AND** `session.metadata["senderId"]` and `session.metadata["userId"]` equal that sender ID

#### Scenario: Group text keeps room and sender identities
- **WHEN** iLink returns a text message with a room identifier
- **THEN** the adapter commits a group event whose session ID is the room identifier
- **AND** the sender metadata remains the originating user ID

#### Scenario: Unsupported message is ignored safely
- **WHEN** an iLink update is self-originated, empty, or contains only unsupported item types
- **THEN** the adapter does not commit an empty event and continues polling

### Requirement: Durable cursor and reply context
The adapter SHALL persist the long-poll cursor and latest context token per peer without persisting the primary bot credential.

#### Scenario: Successful batch advances cursor
- **WHEN** every supported message in an update batch is committed or deliberately ignored
- **THEN** the returned `get_updates_buf` is atomically stored for the next poll and process restart

#### Scenario: Failed delivery retains cursor
- **WHEN** committing any supported message raises an error
- **THEN** the batch cursor is not advanced so the message can be retried

#### Scenario: Context token survives restart
- **WHEN** an inbound peer message provides a context token and the adapter later restarts
- **THEN** the next reply to that peer uses the restored context token

### Requirement: Duplicate suppression
The adapter SHALL suppress recently processed iLink message IDs within a bounded in-memory TTL while preserving retry of messages whose pipeline commit failed.

#### Scenario: Repeated message ID is committed once
- **WHEN** the same successfully processed message ID appears again before the deduplication TTL expires
- **THEN** only the first occurrence is committed

#### Scenario: Failed message remains retryable
- **WHEN** a message commit fails before its ID is marked processed
- **THEN** a later poll containing the same ID attempts the commit again

### Requirement: Reliable outbound text delivery
The adapter SHALL send non-blank text through iLink in bounded Unicode-safe chunks, SHALL serialize concurrent text deliveries, and SHALL return the first generated client message ID.

#### Scenario: Long Unicode text is chunked without corruption
- **WHEN** outbound text exceeds the configured maximum code-point count
- **THEN** every sent chunk is within the limit and concatenating the chunks reproduces the original text

#### Scenario: Concurrent replies do not interleave chunks
- **WHEN** two coroutines send multi-chunk replies concurrently through one adapter
- **THEN** all chunks of one reply are submitted before chunks of the other reply

#### Scenario: Blank text is rejected
- **WHEN** `sendMessage` receives a chain with no non-blank text
- **THEN** it fails locally without making an iLink request

### Requirement: Context expiry and rate-limit protection
The adapter MUST distinguish stale context from genuine frequency limiting and MUST use bounded recovery behavior.

#### Scenario: Stale context falls back once
- **WHEN** iLink reports an expired context and a saved context token was used
- **THEN** the adapter removes that peer token and retries the chunk once without it

#### Scenario: Genuine frequency limit opens cooldown
- **WHEN** iLink returns frequency-limit code `-2` with a non-stale error message
- **THEN** the adapter opens a local cooldown and rejects additional sends during that interval without calling iLink

#### Scenario: Retryable transport failure is bounded
- **WHEN** a send fails with a retryable transport error
- **THEN** the adapter retries with configured backoff no more than the configured retry count and then surfaces the failure

### Requirement: Polling resilience and lifecycle cleanup
The adapter SHALL continue polling after recoverable failures with bounded backoff, SHALL stop promptly on cancellation, and SHALL release its HTTP resources idempotently.

#### Scenario: Recoverable poll failure backs off
- **WHEN** a long-poll request fails with a recoverable transport or server error
- **THEN** the adapter logs a secret-safe warning, waits no longer than the configured maximum backoff, and polls again from the unchanged cursor

#### Scenario: Termination releases resources
- **WHEN** the platform is terminated or disabled through configuration reload
- **THEN** its HTTP client is closed and the polling job can be cancelled and joined without leaking work

#### Scenario: Repeated termination is safe
- **WHEN** `terminate()` is called more than once
- **THEN** later calls complete without creating a new client or throwing due to an already-closed client
