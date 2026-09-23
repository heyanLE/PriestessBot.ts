## Context

The current runtime already supports typed immutable generations, revisioned authoring, IM adapters, tools, and SQLite persistence. Its Workspace abstraction mixes routing, resource ownership, and Agent definitions. The new product exposes application-wide resources and independent Agents instead. Existing visual tokens and components remain the Dashboard foundation.

## Goals / Non-Goals

**Goals:** one v3 authoring model; ordered IM routing; per-IM sender roles; complete Agent composition; three skill sources with permissions; named memory libraries; explicit persona and MCP selection; durable inspectable executions; validated UI editing and direct development migration.

**Non-Goals:** plugin feature expansion, a new visual design, arbitrary user-defined command scripts, or an external vector database dependency.

## Decisions

1. Persist runtime, platformDirectory, ims, llms, agents and shared resource catalogs in the v3 application document. Agent configuration/temp directories hold their skill and working files. Platform-owned skills and a resource database live below platformDirectory. Global runtime infrastructure keeps its existing meaning.
2. Keep immutable compiled generations internally. Reuse existing provider/platform lifecycle and bounded resource handles while replacing Workspace authoring with per-Agent compiled composition. Legacy file formats are migration inputs only, never parallel editable authorities.
3. Route before waking, permission resolution, and Agent execution. An ordered list is the priority source. Match session type, configurable mention/reply conditions and targets, and exact/prefix/glob text after optional structural mention removal. No match means no model request. Built-in commands consume the matched route's prefix.
4. IM permission lists resolve SUPER_ADMIN, ADMIN, or OPERATOR and are injected as application facts into the Agent message context. The Dashboard test surface uses its authenticated administrative context without impersonating an IM.
5. An Agent selects one LLM connection and model/generation settings, directories, platform skill mounts with permission requirements, local configuration/temp skills, memory libraries, one persona, MCP IDs, and tools. Skill documents remain separate from real conversation history. Persona examples become explicitly labeled style reference and cannot be mistaken for stored user turns or split in half by truncation.
6. Named memory libraries group existing typed/scoped memory records. Retrieval applies library and scope authorization before lexical relevance and recency ranking. This provides inspectable retrieval-augmented memory without assuming an embedding provider is configured. Writes target an enabled selected library; disabled libraries cannot be searched or injected.
7. Execution logging uses one run summary plus ordered append-only events, inspired by deepseek-harness. Record actual model-bound requests, responses/usage, tool calls/results, failures and terminal state. Persist bounded, credential-redacted payloads; expose paginated filtering/detail APIs. System logging remains separate.
8. Configuration APIs use revision checks and validate references before publication. The Dashboard presents structured forms, catalog selectors, reorderable routes and route preview, with existing typography/colors/layout components.

## Risks / Trade-offs

- Destructive development migration → validate the complete converted document and data mapping before replacement; user explicitly declined backups.
- Mention/reply normalization causing false activation → only trust structured platform components and verified reply metadata; literal CQ-looking text is never reinterpreted.
- Shared resources leaking between Agents → compile selections into each run and enforce both advertised and executed permissions.
- Model context and log size → bounded style examples, tool materialization and trace payload limits with visible truncation.
- Existing NAS connectivity may be unavailable → complete local implementation and deployment artifacts, then deploy only when the host is reachable; never claim an unavailable deployment succeeded.

## Migration Plan

Convert v2 provider/platform/workspace declarations into v3 LLM/IM/Agent/resource catalogs, namespace duplicate Agent IDs, translate routes and IM roles, move persona/memory ownership to the platform resource store, and replace the source directly without backup. Preserve useful persona/memory content where representable; report any intentionally removed unsupported fields. Validate startup and routing before deployment.

## Open Questions

Resolved by user: mention/reply behavior belongs to the route table; migration is destructive with no backups. Library retrieval starts with scoped lexical retrieval; embedding retrieval can be introduced independently later.
