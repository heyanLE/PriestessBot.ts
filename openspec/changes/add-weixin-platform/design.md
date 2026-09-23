## Context

PriestessBot already starts built-in platform adapters from `PlatformConfig`, forwards their unified `MessageEvent` values into the pipeline, and stops them during configuration changes or process shutdown. The reference Hermes implementation demonstrates the protocol details needed for personal WeChat: iLink-specific headers, long-poll cursors, per-peer `context_token` values, text chunking, stale-session fallback, rate-limit protection, and explicit resource cleanup.

The iLink API is an external, account-gated service whose availability and protocol evolution are not controlled by this project. The first implementation therefore needs a narrow protocol boundary, durable state, and deterministic tests that do not depend on a live WeChat account.

## Goals / Non-Goals

**Goals:**

- Add a built-in personal-WeChat adapter without changing the shared `Platform` API.
- Let an operator complete iLink QR login from the authenticated Dashboard without manually extracting credentials.
- Provide at-least-once inbound text delivery with durable long-poll progress and in-process deduplication.
- Preserve the latest peer context token and use it for replies across restarts.
- Bound every retry/backoff path, serialize outbound chunks, and fail with actionable errors.
- Make protocol behavior testable through an injected API boundary and filesystem state location.
- Reuse existing Ktor, coroutine, serialization, logging, and configuration facilities.

**Non-Goals:**

- Media encryption/upload/download, typing indicators, message editing, or streaming replies in this first adapter version.
- Guaranteeing ordinary WeChat group delivery, which depends on iLink account capabilities.
- Hiding Tencent service outages, account restrictions, or undocumented protocol changes.

## Decisions

### 1. Keep the adapter at the platform edge

The built-in registry will map type `weixin` to a new adapter package. `PlatformConfig.token` carries the credential, `baseUrl` optionally overrides the iLink endpoint, and adapter-specific values remain in `PlatformConfig.config`. This avoids adding WeChat fields to the shared configuration model.

Alternative considered: extend `PlatformConfig` with every iLink option. Rejected because it couples all platforms to one adapter and makes future adapters grow the common schema.

### 2. Separate protocol transport from lifecycle and mapping

`WeixinApi` will own iLink HTTP/header/JSON details, while `WeixinPlatform` owns polling, event mapping, retry policy, context state, and the `Platform` lifecycle. Production uses Ktor CIO; tests inject a deterministic fake API.

Alternative considered: issue Ktor requests directly throughout `WeixinPlatform`. Rejected because lifecycle tests would depend on HTTP request internals and protocol error behavior would be difficult to isolate.

### 3. Persist only resumable protocol state

A small JSON state file stores the latest `get_updates_buf` and context tokens keyed by peer. Writes use a temporary sibling plus atomic replace when supported. Credentials are never written. The default state directory is `.priestess/weixin/<instance-name>`, with an explicit `stateDirectory` override for deployments and tests.

The cursor is advanced only after every supported message in a response has either been committed successfully or deliberately ignored. If pipeline delivery fails, the cursor remains unchanged; already-successful messages are suppressed by the in-process TTL deduplicator on retry. This yields at-least-once behavior across process crashes rather than silently losing messages.

Alternative considered: keep cursor/context only in memory. Rejected because restart replay and loss of reply context are avoidable reliability failures.

### 4. Treat text as the supported contract and degrade unsupported items safely

Inbound text items are concatenated into one `MessageChain.Text`. Empty, self-originated, and currently unsupported media-only messages are ignored without crashing the poller. Session metadata exposes `senderId`/`userId`; it does not expose tokens. Direct chats use the sender as the session ID, while messages with an iLink room identifier use a group session.

Alternative considered: represent encrypted CDN references as public image/file URLs. Rejected because those references require authenticated AES processing and would produce unusable or unsafe components.

### 5. Make outbound delivery conservative

Text is split by Unicode code point with a 2,000-code-point default and paragraph/newline preference. A mutex prevents chunk interleaving across concurrent sends. Transport failures receive a bounded linear backoff; genuine `-2` frequency-limit responses open a local cooldown immediately. A stale context response (`-14`, or `-2` with `unknown error`) clears the saved peer token and retries once without it. Other API errors are surfaced immediately.

Alternative considered: retry every non-zero iLink response. Rejected because authentication, validation, and rate-limit failures are not made safer by repeated traffic.

### 6. Use structured coroutine ownership and idempotent cleanup

`run()` validates configuration before creating the API client and returns one IO polling job. Cancellation exits without retry delay. `terminate()` closes the active client and can be called repeatedly; the controller remains responsible for cancelling/joining the returned job.

### 7. Provide QR login as an authenticated management flow

The Dashboard starts a short-lived server-side QR session for one configured `weixin` platform. A dedicated tokenless iLink client fetches `get_bot_qrcode`, and the server renders `qrcode_img_content` locally as a PNG data URL without a third-party image service. A bounded server coroutine advances the state machine through `wait`, `scaned`, `scaned_but_redirect`, `expired`, and `confirmed`, while Dashboard polling only reads the cached view; QR codes refresh at most three times within an eight-minute monotonic deadline. Cancellation closes the client and terminates the session.

On confirmation, the server validates `ilink_bot_id`, `bot_token`, and the returned HTTPS iLink origin, writes them atomically to `<stateDirectory>/credentials.json` with owner-only permissions where supported, then restarts only the selected platform instance. Environment/config credentials take precedence over saved QR credentials, so existing deployments remain deterministic.

Alternative considered: return the bot token to the browser and ask the user to paste it into configuration. Rejected because it unnecessarily exposes a long-lived secret to frontend state and browser tooling. Alternative considered: use a public QR image service. Rejected because it would disclose the login payload to a third party.

## Risks / Trade-offs

- [iLink is externally controlled and may change] → isolate endpoints and response interpretation in `WeixinApi`, validate response codes, and cover request contracts with tests.
- [Personal-WeChat bot access may not be enabled for every account] → document account eligibility and fail startup clearly when credentials are absent.
- [Cursor persistence can replay after a crash between message handling and state write] → define at-least-once semantics and include message IDs so downstream code can correlate duplicates.
- [A custom state directory may be unwritable] → validate/create it during startup and fail before polling rather than running without persistence.
- [Text-only scope omits common WeChat media] → ignore unsupported media safely and leave encrypted media transport as a follow-up capability.
- [Long replies can trigger server throttling] → limit chunk size, serialize sends, delay chunks, bound retries, and open a cooldown on explicit frequency limits.
- [QR redirect fields could be abused for server-side requests] → allow only HTTPS origins under `weixin.qq.com`, reject user info/ports/paths/query/fragment, and reset to the canonical origin when a code is refreshed.
- [QR credentials are long-lived secrets] → never return them through Dashboard DTOs or logs, write atomically with best-effort `0600`, and keep them outside versioned config/backups.

## Migration Plan

1. Deploy the code with no `weixin` entry; existing platform behavior is unchanged.
2. Add an enabled `weixin` connection without a token/account ID and open its Dashboard card.
3. Start QR login, scan with WeChat, and confirm on the phone; the Dashboard stores the issued credential and restarts the adapter.
4. Observe startup and polling status, then validate one inbound message and one reply.
5. To roll back, disable or remove the platform entry. The isolated state directory can be retained for later re-enable or deleted after shutdown.

## Open Questions

- Media encryption/upload/download remains a candidate for a follow-up change after text and QR login are validated against a real eligible account.
