## 1. Prompt and search configuration
- [x] 1.1 Align Agent persona selection and effective prompt preview with AstrBotX configuration.
- [x] 1.2 Implement configurable search/fetch adapters, management UI and credential migration.
- [x] 1.3 Test prompt binding, search disable, validation, citations and upstream failures.

## 2. NapCat and QQ file plugin
- [x] 2.1 Implement scoped typed group files/albums/members/notices and authorized mutations.
- [x] 2.2 Add file-upload matching templates and integrate real ingress/tools/artifact delivery.
- [x] 2.3 Test pagination, access boundaries, revocation, cancellation and protocol failures.

## 3. Native plugin workspace and remaining plugins
- [x] 3.1 Add typed plugin catalogue/settings/status/jobs and lifecycle hooks to runtime and Dashboard.
- [x] 3.2 Implement Markdown cleanup, table/formula rendering and configured fallbacks.
- [x] 3.3 Implement Bilibili tools, content/summary, login and subscription workflows.
- [x] 3.4 Implement Bangumi lookup/calendar/collection/subscription workflows.
- [x] 3.5 Implement scoped local reminiscence events/reflections/topics/nodes, retrieval and daily jobs.
- [x] 3.6 Record pinned source/license attribution and per-plugin capability/prerequisite coverage.

## 4. Integration and NAS delivery
- [x] 4.1 Wire all runtime tools/hooks/commands with permission intersections and safe delivery.
- [x] 4.2 Pass strict types/lint, backend tests and production Dashboard/server builds.
- [x] 4.3 Verify real read-only NapCat/search/media APIs and plugin Dashboard workflows.
- [x] 4.4 Migrate supported NAS plugin settings, preserve unsupported state, back up and deploy safely.

Validation and deployment evidence: `typescript/docs/native-plugin-deployment-20261026.md`. Bangumi NAS calls remain dependent on a usable proxy because current DNS/TLS connectivity failed; this prerequisite is exposed and documented, not claimed as passing.
