# Native plugin deployment — 2026-10-26

Active NAS release: `/home/heyanhub/apps/priestess/releases/20261026-native-plugins-audit`.
Archive SHA-256: `4eb14680911dbb0ac74cf75638f7c0651b352d98b6c22c8bbb9ffe226563de71`.
Dashboard: `http://home-nas.et.net:6185`.

## Validation

- Strict TypeScript, complete ESLint and 250 backend tests passed.
- Dashboard strict gate, Vue type checking and production build passed.
- Real NAS Chromium produced a valid PNG containing Chinese text, a table and a formula.
- Real NapCat group files, members and announcements returned success and passed the deployed production schemas. No external writes or group messages were used for verification.
- The migrated DeepSeek Search endpoint returned HTTP 200. The dedicated Dashboard deployment-test conversation completed an actual SDK `web_search` call and persisted its function result.
- Bilibili public video lookup returned HTTP 200 and API code 0.
- Bangumi works through a suitable proxy in development. NAS system DNS returned incorrect addresses; verified upstream addresses accepted TCP but reset TLS. No system DNS edits, fixed upstream IPs or Mac-dependent proxies were installed. The plugin exposes an independent managed-secret proxy reference; NAS requires a usable persistent proxy before Bangumi business calls can succeed.
- Native UI inspection confirmed the plugin catalogue, migrated enabled states, green theme and independent search form. Existing user tabs and drafts were preserved.

## Migration and rollback

Five old configuration files imported four plugins plus independent search, one secret, one Agent tool binding update and two existing grant tool-binding updates. No grant capability or operator level was raised. Existing Agent instructions, persona, examples, model and context policy were checked unchanged. Runtime configuration advanced from revision 2 to 3; the audit-only update preserved revision 3.

QQ dangerous mutations require tool approval. Newly introduced subscription pushes and local reminiscence automation remain off. Bilibili QR-cookie source file was absent at its pinned upstream data path; login can be performed in the plugin UI. Unsupported upstream presentation templates remain in the original configuration files. Arbitrary old Python plugin code and cross-scope state were not executed or replayed.

Pre-migration backup: `/home/heyanhub/apps/priestess/backups/native-plugins-20261025-162146` (NAS directory timestamps are UTC). Additional database backup was taken before the audit-only release. Previous releases and original AstrBotX data remain available. `priestess-ts.service` is active; NapCat is connected. The original AstrBotX service remains stopped.

For capabilities, limitations and source licenses see [capability matrix](native-plugin-capabilities.md), [migration](native-plugin-migration.md), [search/prompt behavior](search-and-prompt-parity.md) and [local reminiscence](local-reminiscence-parity.md).
