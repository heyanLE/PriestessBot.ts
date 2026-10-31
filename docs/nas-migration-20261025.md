# NAS migration — 2026-10-25

## Active deployment

- Host: home-nas /10.77.0.2, user heyanhub, x86_64 Ubuntu.
- Service: priestess-ts.service (systemd --user), active+enabled; user lingering enabled.
- URL: http://home-nas.et.net:6185/ (EasyTier), bound only10.77.0.2:6185.
- Root: /home/heyanhub/apps/priestess; current -> releases/20261025-ts-migration.
- Data: /home/heyanhub/apps/priestess/data; runtime.env in config/ (0600).
- Node22.22.1,113production packages, npm audit0vulnerabilities. Native PTY compiled with installed make/g++. Python tool dependencies reuse the preserved AstrBotX release virtualenv.
- Release SHA256:1c9e178afc061fca01455fdf2398701ac3e07fab11090f9aa2b4abcbd4eb2658;78manifest files verified.

## Migration and checks

- Old astrbotx.service is inactive+disabled. Its release and original data remain intact.
- Backup: /home/heyanhub/apps/astrbotx/backups/priestess-migration-20261025-222351 (0700). Contains service metadata, data.tar.gz (0600) and NapCat pre-cutover config (0600). Temporary files/dependency cache excluded; original source remains.
- NapCat existing forwardWS10001 reused. Only the old reverse client named astrbotx was disabled through the official WebUI API. QQ process/container was not restarted.
- Imported1Agent,1NapCatinstance,1persona,8examplemessages,4Skills,2credentialreferences; exact persona text/examples verified.
- Imported10model-history conversations/900messages and11platform-history groups/2117messages. Historical conversations are archived, not replayed into new SDK state.1attachment imported,0missing;2721original database rows preserved privately.
- Retained32768compaction threshold,5queued turns,600second timeout,disabled rate limit,4allowlist entries and scoped administrator bypass. Long-term memory remains disabled as in source; Codex memory source had no actual memory records.
- Python plugin files/config and Codex internals archived, not executable TS equivalents. Prior password auth archived; management uses a new token stored only in data/management-token. No secret values in this document.
-167/167tests passed; strict types/lint and production builds passed. Real DeepSeek semantic compression preserved synthetic preference; NAS model self-test completed with 部署验证通过. QQ adapter reports connected and container can reach signed-media service host.
- Browser authentication and migrated persona examples verified in Edge. The original local browser drafts were not replaced.

## Rollback

Stop/disable priestess-ts.service before re-enabling astrbotx.service. Restore only the old NapCat reverse-client configuration from the private pre-cutover backup via its official API, then start the original service. Preserve the new Priestess data directory; post-migration changes are not automatically backported. Never run both consumers during rollback.

## Context behavior update — 2026-10-25

- Active release is now `/home/heyanhub/apps/priestess/releases/20261025-context-parity`. Prior release and its Linux dependencies remain retained.
- SHA256: `c4f95432542254a4e3b10dd3f8c1af6fce7f899b532be1f555c00c693adad5c5`;84release files verified, identical lockfile dependencies reused.
- Pre-cutover data backup: `/home/heyanhub/apps/priestess/backups/context-parity-20261025-234043/runtime.sqlite` (0600).
- Source-verified legacy migration:3histories,9messages updated,0blocked. Exact original SDK history retained privately.
- New active policy defaults: provider usage plus appended-tail estimate, keepRecentRatio0.15, trimTurns1; original32768threshold retained. Context window128000; maxTurns-1.
-197/197tests passed without skips; strict TypeScript, lint and frontend/server builds passed. Real DeepSeek compression retained the synthetic preference (4479→263reported/context-count values).
- NAS health/QQ connected verified; a new continuation from the synthetic two-message deployment test answered the prior fixed reply correctly. No user private history was sent during this validation.
- Existing browser Agent configuration showed an unsaved draft; it was left intact. Refresh the UI after saving/exporting that draft to load the new controls.
