# Message processing and concurrent input

Protocol adapters remain the source of sender, platform, chat kind and message identity. The context builder adds escaped, bounded message metadata, speaker changes, public group context, quotes and attachment descriptors. Text in quotes, file names, display names and historical messages is untrusted data; it cannot select a runtime permission state. Metadata and attachment descriptions take priority within the 16,000-character context budget. Group history is additionally bounded by serialized size.

## Active-run follow-ups

The same sender can add up to eight messages (64,000 serialized characters total) to one active run. Acceptance still passes the configured routing, deduplication, group attention, rate and authorization checks. The platform adapter, Agent, conversation generation, configuration revision and principal must match. Control commands are immediate; extension commands and other senders use separate turns. Overflow becomes a normal queued turn.

The installed official Agents SDK0.21.0 invokes `callModelInputFilter` before every model request, including requests after tool execution. The runtime drains the current sender's mailbox there without closing it and includes accepted inputs in that same logical run. SDK persistence retains each added message once. Inputs received after the final model call use a continuation with the same authority/cancellation/token/turn budget. An empty mailbox is atomically sealed before final delivery. An already-dispatched network request is not rewritten and completed tool effects are never replayed. Editable IM previews can be replaced; non-editable transports receive the final reply only.

Accepted follow-ups are captured in the durable transcript immediately and stored separately with consumption markers. A pending approval can survive restart and admit the pending follow-ups after explicit approval resumes. Interrupted non-paused work is not automatically replayed. Failed or cancelled runs retain the original accepted input in the transcript for inspection.

## Model context compaction

Each Agent has a configurable context policy: estimated context window, compaction threshold, retained target, optional maximum turns, summary model/connection, output budget, timeout and additional summary instructions. Defaults use semantic summaries at32,768 estimated tokens toward16,384 retained tokens. The estimate is UTF-8 bytes/3 with an image allowance, not an exact provider tokenizer count. System instructions, examples, tool overhead and output allowance are reserved separately.

Agents SDK runs a bounded tool-free JSON summarizer over old complete turns. It preserves goals, constraints, decisions, completed side effects and uncertainties. Summary usage counts toward the same run budget. Failed or invalid summaries fall back to bounded extracts; cancellation, revoked authorization and concurrent history changes prevent persistence. Identical removed prefixes reuse the summary within a logical run instead of paying twice for input filtering and session persistence. Each compression records source SHA-256, item counts, strategy, estimated sizes and optional model/fallback reason. Complete management transcripts remain intact.

Only whole user-turn boundaries with balanced function/computer/shell/patch call-result pairs can be removed; orphan results and duplicate outstanding call IDs fail validation. Recent active tool rounds are retained together. A single indivisible turn can exceed the target but is refused above the existing four-million-character hard bound. Full conversation transcripts live in a separate persistence namespace and are not erased by compaction. Session identity continues to include the principal, Agent, generation, runtime state and grant revision.

Validation: `tests/follow-ups.test.ts`, `tests/agents-sdk.test.ts`, `tests/message-processing.test.ts`, plus existing HTTP, background-continuation and delegation regressions. The new tests cover sender isolation, one-time tool effects, queue bounds, cancellation, authority changes, cumulative budgets, approval restart, metadata escaping, complete tool-round compaction and transcript retention.

## Replaceable dynamic context and upgrades

Memory, knowledge and current Skill references are named, complete snapshots fetched before each model call. They are quoted as untrusted user-role data in an outer model adapter and do not enter durable SDK history. Missing components are removed, unchanged snapshots have stable canonical ordering/hash, and compressed requests receive a fresh snapshot. The final escaped request is hard-window checked immediately before provider dispatch, after any asynchronous summary or source updates. Actual provider input usage is stored against the exact history prefix; missing/stale coverage falls back to AstrBotX character/image weights.

`migrate-context-state --database PATH` validates existing older SDK context offline. Apply requires `--apply --runtime-stopped` after backup. It checks authentic metadata, context-unit hashes and exact transcript body ownership before stripping old host-injected dynamic blocks. Original SDK JSON is privately archived byte-for-byte. Any unverifiable source blocks the entire migration. User-authored lookalike tags and full tool chains remain intact.

Management now offers **从历史继续**: it creates a new Dashboard conversation with scoped, provenance-bearing historical text. Raw Codex execution state and past tools are not replayed; the original archive remains available. Continuation seeds and SDK history commit atomically and are bound to principal, Agent, generation, state and grant version.
