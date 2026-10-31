## Context

NAS runs the typed Agents SDK runtime, NapCat and a bound Fiammetta persona. The old AstrBotX installation has independent DeepSeek Search credentials and configurations for QQ files, Markdown output, Bilibili and Bangumi. Its Python plugins are preserved but not executed. Native extensions currently expose scalar tools/commands only, without full message or scheduled lifecycle hooks.

## Goals / Non-Goals

**Goals:** clear effective prompt composition; real NapCat and search tools; managed TS plugins implementing useful upstream behaviors with explicit capability/dependency coverage and runtime hooks; deployment preserving current settings and scopes.

**Non-Goals:** arbitrary Python compatibility, automatic execution of downloaded GitHub code, bypassing Bilibili account entitlements or anti-abuse controls, unsolicited new subscriptions, or silently enabling recollection on previously disabled private memories.

## Decisions

- Keep persona library as the primary configuration source. Bound personas own role instructions/examples/tool constraints; supplemental Agent instructions are advanced and visible in an effective-source preview. Keep old inline fields as explicit compatibility fallback.
- Native first-party plugins use typed discriminated settings stored with revisions and a registry of capabilities, hooks, status and tools. Installed/custom extensions remain available. Hooks execute within original message identity and configured permission ceilings; disable/revocation is rechecked before side effects.
- NapCat uses a typed action allowlist through the existing live adapter. Group reads are limited to current groups or explicitly authorized administrators; writes also require external.write and mounted tool authorization. File artifacts cross hosts via existing short-lived signed URLs; never send host-only paths to NapCat.
- Search is independent of chat provider. DeepSeek Search/Fetch follows the inspected local implementation; configured alternatives use typed request/response normalization, bounded content and credential-free diagnostics. Tool query URLs cannot choose credential destinations.
- Plugin ingress normalization, reply decoration and scheduled jobs are explicit integration points. Formatting occurs before delivery segmentation. Autonomous subscriptions are disabled unless configured with an authorized destination and bounded retry/dedupe semantics.
- Local reminiscence maintains scoped daily events, reflections, topics and nodes separately from raw transcripts. Local embeddings are truly local when selected; lexical fallback is labeled honestly. Daily cutover/timezone and policies are configurable; private scopes never merge automatically.
- No downloaded plugin is imported into the running process. Pinned sources guide clean TS implementations, with attribution/license records. External account/model/browser prerequisites remain observable states, not fake success.

## Risks / Trade-offs

- IM write/delete actions affect real groups → scoped APIs, role/capability/tool gates and existing per-tool approvals; tests use fake transports, no real destructive smoke.
- Provider/API changes → pinned examples, fixtures, bounded error handling and live read-only checks.
- Rendering/model dependencies → package explicitly and expose availability; retain configured fallback rather than blocking text delivery.
- Background work survives configuration changes → durable jobs, owner scope, cancellation and no duplicate uncertain sends.

## Migration Plan

Preserve source configurations privately; map supported fields and credentials into typed settings with a report. Enable requested read tools only after validation; leave new subscriptions and reminiscence automation disabled. Build/test, back up idle NAS state, deploy to a new release, verify APIs and read-only business flows, and preserve old release rollback.
