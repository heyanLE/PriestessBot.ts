## Why

PriestessBot currently supports Telegram and QQ/NapCat but cannot serve users through personal WeChat. Adding a native personal-WeChat adapter based on Tencent's iLink Bot API extends the platform edge while preserving the existing unified message and pipeline contracts.

## What Changes

- Add a built-in `weixin` platform adapter for personal WeChat accounts using iLink long polling.
- Add a Dashboard QR-login flow that fetches a scannable iLink code, tracks scan/confirmation/expiry, securely stores the returned credential, and starts the selected Weixin platform.
- Convert supported inbound iLink text messages into unified `MessageEvent` values with stable session and sender identity metadata.
- Send outbound text through iLink with context-token reuse, deterministic chunking, serialized delivery, bounded retry, rate-limit cooldown, and stale-session fallback.
- Persist the iLink polling cursor and per-peer context tokens so restarts do not unnecessarily replay messages or lose reply context.
- Validate required credentials and tunable limits at startup, and close polling/network resources cleanly on shutdown or configuration reload.
- Add protocol-focused unit/integration tests and configuration documentation without requiring a live WeChat account in the automated suite.

## Capabilities

### New Capabilities

- `weixin-platform`: Personal WeChat iLink configuration, long-poll reception, unified event mapping, reliable text delivery, durable protocol state, and lifecycle behavior.

### Modified Capabilities

None. The adapter implements the existing platform abstraction without changing its public contract.

## Impact

- Affected code: platform built-in registration, a new `platform/adapters/weixin` package, platform tests, and user-facing configuration documentation.
- APIs and configuration: adds platform type `weixin` plus authenticated Dashboard QR-login endpoints; environment credentials remain supported, while QR-issued credentials use a platform-owned owner-readable credential file outside the versioned configuration document.
- Dependencies: uses the existing Ktor client, kotlinx.serialization, and coroutine stack; ZXing Core renders QR content locally without exposing it to a third-party image service.
- External system: Tencent iLink Bot API availability, account eligibility, and server-side limits remain outside PriestessBot's control.
