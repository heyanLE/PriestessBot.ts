## 1. Configuration and migration

- [x] 1.1 Define and validate the v3 IM, LLM, Agent and platform resource authoring model.
- [x] 1.2 Compile v3 into immutable runtime generations and provide revisioned preview/apply/reload APIs.
- [x] 1.3 Implement direct v2 development migration and migrate local configuration/data without backups.

## 2. Routing and Agent composition

- [x] 2.1 Implement ordered IM route matching, defaults, route preview and protocol attention metadata.
- [x] 2.2 Route the pipeline to Agents or built-in commands and resolve per-IM sender permissions.
- [x] 2.3 Compose three skill sources with explicit mount permissions and Agent directory context.
- [x] 2.4 Implement named memory libraries and enforce selected libraries/scopes for retrieval, injection and writes.
- [x] 2.5 Bind one selected persona and isolate its examples from real conversation history.
- [x] 2.6 Select platform MCP/tool resources per Agent and retain safe lifecycle behavior.

## 3. Execution observability

- [x] 3.1 Implement durable run summaries and ordered bounded/redacted model and tool events.
- [x] 3.2 Integrate terminal status, failure/cancellation, timing and usage into actual pipeline execution.
- [x] 3.3 Expose paginated IM/LLM/Agent/status filtering and execution detail APIs.

## 4. Dashboard

- [x] 4.1 Replace Workspace-oriented navigation with IM, LLM, Agent and resource management.
- [x] 4.2 Implement Agent creation/editing and all resource selection controls.
- [x] 4.3 Implement IM route tables, ordering, matching controls and route preview.
- [x] 4.4 Implement platform/configuration/temp skill views and memory/persona/MCP/tool catalogs.
- [x] 4.5 Separate system logs and LLM execution chains with filtering and detail views.

## 5. Validation and rollout

- [x] 5.1 Run routing, migration, resource isolation, context and execution-trace backend tests.
- [x] 5.2 Build and smoke-test the Dashboard, inspect main flows in a browser and retain visual consistency.
- [x] 5.3 Update configuration and deployment documentation.
- [ ] 5.4 Build a complete distribution and deploy/migrate the NAS when reachable; verify health and actual routing.

## Rollout status

Local v3 migration, backend tests, final packaged runtime smoke, and real Dashboard/API flows completed on 2026-09-16. NAS deployment remains pending: SSH to 192.168.31.24:22 timed out on two read-only connection attempts. No NAS files or processes were changed during this refactor. The release archive and deployment scripts are ready.
