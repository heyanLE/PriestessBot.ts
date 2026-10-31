# Tool output and run-limit behavior

Reference implementations: local AstrBotX `astrbot/core/agent/runners/tool_loop_agent_runner.py` (`_materialize_large_tool_result`) and `astrbot/core/tools/computer_tools/codex_exec.py` (`truncate_middle`, `format_exec_response`). AstrBotX's primary Codex runner delegates context compaction to its engine; the local runner also maintains a cumulative usage statistic, but that statistic is not the TS runtime's cumulative hard cap. Its local step ceiling removes tools and requests one final response.

## Text results

All assembled SDK function tools — builtin, MCP, search and native plugins — share one output boundary. Short outputs retain their original shape. Ordinary text over 27,500 estimated tokens is saved privately; inline preview is capped at 7,000 estimated tokens and carries an opaque result ID and continuation instructions. Estimation uses the same Chinese/non-Chinese weights as the runtime context counter. MCP text/structured-content duplication cannot bypass the aggregate cap; image/file/binary blocks retain their shape.

`read_tool_result` reads a bounded page and `search_tool_result` performs literal search. Offsets use UTF-16 characters, include an explicit next cursor, preserve surrogate pairs and cannot recursively spill their own pages. Readers require their own tool binding and the original source tool's current authorization, sender/chat/Agent/generation/state/grant epoch, plus source-configuration epoch. No filesystem path is exposed. Legacy results are marked potentially incomplete.

Full ordinary results are capped at 16 MiB each, 256 MiB total and seven-day retention. Storage/capacity/corruption errors explicitly say that a complete result is unavailable; a preview is never passed off as the full output. Files are private (0600) under the runtime data directory's `tool-results` folder.

## Process output

`exec_command`, `write_stdin` and `process_poll` accept `max_output_tokens`, default 10,000 and bounded to 256–40,000, matching the AstrBotX exec adapter's four-character approximation. ANSI/control sequences and CR line endings are normalized. Oversized output preserves head and tail with an omitted-middle marker. `offset` remains the legacy total-output end; `nextOffset` points to where continuation should begin. `process_read_output` reads sequential ranges from the original process log. Per-process private logs retain up to 16 MiB, with any unrecoverable gap explicitly reported. Process ownership and current permission checks remain enforced. Process handles are runtime-local; ordinary saved tool results are readable across restart while their authorization epochs remain valid.

## Token limits and finalization

Every provider response immediately emits an input/output usage event, including responses that exhaust the configured limit. Compression, finalization and child-task aggregation are labeled separately; child costs are not counted twice and failure/approval paths retain accounting.

`budget.tokenLimitMode` defaults to `cumulative`, preserving existing configured limits. It reserves room for a no-tool final answer before continuing another expensive loop. Finalization retains the original ordered conversation, current quotes/images, persona anchors and tool-call/result pairs under the normal context window policy. It appends a limit notice and disables tools; it does not truncate persona to 1,200 characters or reconstruct tool results from 4,000-character excerpts. If an optional cumulative budget cannot accommodate the intact active request, a deterministic incomplete-work notice is returned rather than silently amputating evidence. Paused approvals retain their original identity and are not finalized automatically.

The optional `context` mode controls context window, step count, timeout and individual output allowance without cumulative token exhaustion. Parent/child and background-continuation behavior follows the chosen mode; a cumulative parent cannot be bypassed by a context-mode child. The Dashboard labels the modes and shows per-call usage. Existing NAS cumulative limits are preserved unless the user selects otherwise.

The previous PDF evaluation's 12,147-character output was below AstrBotX's ordinary spill threshold; long-output parity alone cannot eliminate cumulative-budget failures. Bounded outputs, explicit continuation and reserved finalization address different parts of the problem.

## Deployment verification — 2026-10-26 (Asia/Shanghai)

- Strict TypeScript, full ESLint and 317 backend tests passed; Dashboard strict checks and production build passed.
- NAS isolated live-model test produced a large synthetic result and used `search_tool_result` to find its undisclosed random verification code. Three model usage events were retained.
- NAS PTY test produced 200,008 characters, returned a 1,024-character head/tail preview at a 256-token setting, and reconstructed the complete original output through sequential pages.
- Active release: `/home/heyanhub/apps/priestess/releases/20261026-tool-output`; SHA-256 `5350a4d7b09f4fbec2ba35bf6c5008e501be4e32737de11eb487dcea22a7a406`.
- Pre-switch backup: `/home/heyanhub/apps/priestess/backups/tool-output-20261025-191754` (NAS directory timestamp UTC).
- Config revision 5 adds needed reader bindings to the existing Agent/grants without increasing capability or runtime-state ceilings. The existing cumulative 100,000-token budget remains selected. Source persona/configuration values otherwise remain intact.
- Deployment used the registered LAN SSH entry because the Mac-to-NAS EasyTier connection was temporarily unavailable. NAS service health and NapCat connection were verified after switching. No real IM messages or user PDF tasks were replayed during verification.

## Prompt assembly update — 2026-10-26

NAS revision 6 already selects `context` mode, as requested by the user. The prompt assembly update preserves that selection. Earlier deployment notes above describe revision 5, not the current configuration.

## Prompt assembly deployment verification — 2026-10-26 (Asia/Shanghai)

- Strict TypeScript, ESLint and all 330 backend tests passed; Dashboard production build passed.
- NAS isolated in-memory model smoke retained quoted analysis, actual image parts, full persona/example anchors and tool evidence in the final tool-free request; no real model request or IM message was sent.
- Active release: `/home/heyanhub/apps/priestess/releases/20261026-prompt-parity`; archive SHA-256 `bb7356aaa8dff2be77ab54913f5764d0a0237c50a292f9701b4defaf2743660e`.
- Pre-switch backup: `/home/heyanhub/apps/priestess/backups/prompt-parity-20261026-054858` (NAS timestamp UTC). Health returned `ok`, NapCat `connected`; configuration revision 6 and `context` token mode were retained.
