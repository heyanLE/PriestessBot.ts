# Offline native plugin configuration migration

Run the built CLI against an existing TS runtime database. It reads AstrBotX's `data/config` plugin JSON files, accepts UTF-8 BOM, and never runs Python plugin code.

```sh
node dist/tools/migrate-native-plugins.js --source /home/heyanhub/apps/astrbotx/data/config --database /path/to/runtime.sqlite
```

Default dry-run opens SQLite read-only, does not initialize `RuntimeStore`, and does not alter running-job states, configuration, settings, secrets, source files or create backups. The report contains only counts, skipped categories and capability gaps. An apply requires explicitly stopping the service first:

```sh
node dist/tools/migrate-native-plugins.js --source /home/heyanhub/apps/astrbotx/data/config --database /path/to/runtime.sqlite --apply --runtime-stopped
```

Before writing, the CLI uses SQLite's backup API to create a private `runtime.sqlite.native-plugins-backup-<timestamp>-<uuid>.sqlite` sibling file with mode 0600. Settings, missing credentials, new configuration revision and migration report are then written in one SQLite transaction. Existing `native-plugins/<id>`, `web-search/settings` and `operator-secrets/<name>` documents are preserved. Source configuration files and old plugin databases/caches/subscriptions remain unchanged. Replaying the migration does not re-add tools removed from an already-migrated plugin.

Configuration publication clones the latest stored revision, preserving Agent identity, model, instructions, persona, budget, context policy and all existing resources. It appends imported tool names to Agent and existing grant tool lists; it does not create grants or raise grant capabilities/states. QQ adds only `files.read` to Agent capabilities where missing. QQ delete-file/delete-folder and announcement mutations are added to per-call approvals. Tool binding alone cannot bypass capability checks.

Supported sources: QQ file, Markdown killer, BiliVideo, Bangumi enhance/Bangumi and local DeepSeek Search. Bilibili uses the current Agent summary model, maps BCut/local ASR parameters (600-second default), and preserves image output preference. Automatic subscription delivery is disabled. Local reminiscence is left at its disabled default unless an existing target record already exists, which is preserved.

Only literal suffix regexes such as `.*\.log$` map to bounded native globs. Complex regexes, unresolved skills or implicit empty processing prompts are reported and prevent upload automation from being enabled. Native globs are case-insensitive, unlike a source regex without the ignore-case flag; this difference is reported. Separate legacy Bili detection ACLs that cannot fit the unified native ACL disable automatic detection. Provider-specific presentation, remote renderer, retry, proxy and standalone summary-model options remain in source and appear as gaps rather than being silently fabricated.

The `--runtime-stopped` argument is an explicit operator assertion; the CLI cannot discover a remote process holding the database. Do not use it against a running container.
