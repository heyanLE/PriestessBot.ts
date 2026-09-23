## 1. Protocol Foundation

- [x] 1.1 Define validated Weixin adapter configuration and Unicode-safe text chunking.
- [x] 1.2 Implement the injectable iLink Ktor API client with required headers, timeouts, response validation, and secret-safe errors.
- [x] 1.3 Implement atomic durable storage for the polling cursor and per-peer context tokens without credentials.

## 2. Platform Adapter

- [x] 2.1 Implement long polling, text event mapping, sender/session metadata, successful-message deduplication, and cursor commit semantics.
- [x] 2.2 Implement serialized outbound chunk delivery, stable client IDs, bounded transport retry, stale-context fallback, and frequency-limit cooldown.
- [x] 2.3 Implement cancellation-safe, idempotent lifecycle cleanup and built-in `weixin` registration.

## 3. Verification and Documentation

- [x] 3.1 Add protocol, state-store, chunking, inbound, retry, deduplication, cooldown, and lifecycle tests using deterministic fakes/MockEngine.
- [x] 3.2 Document personal-WeChat scope, credential acquisition assumptions, configuration keys, state behavior, and external limitations.
- [x] 3.3 Run focused and full Gradle verification, resolve change-related failures, and review the final diff against the OpenSpec scenarios (the repository-wide suite retains unrelated baseline failures documented in the handoff).

## 4. QR Login Completion

- [x] 4.1 Implement typed tokenless iLink QR API calls, safe redirect/base URL validation, and local QR PNG rendering.
- [x] 4.2 Implement bounded QR session state management and atomic owner-readable credential persistence.
- [x] 4.3 Resolve saved QR credentials during Weixin platform creation and support targeted platform restart after confirmation.
- [x] 4.4 Add authenticated Dashboard start/status/cancel endpoints and a scan/confirm UI on Weixin platform cards.
- [x] 4.5 Add backend protocol/state/lifecycle tests, frontend build verification, and update operator documentation.
