# Context policy alignment

The TypeScript policy follows the locally reviewed AstrBotX context manager,
round utilities, token counter, truncator and LLM compressor. Agents SDK remains
the inference engine; these rules do not require a Codex thread.

- Provider-reported input usage is stored against the exact sent history prefix
  (SHA-256, item count, reserved input allowance, observation time). Matching
  prefixes use that reported count plus estimated appended items. Changed or
  shortened prefixes invalidate the estimate automatically. Session IDs include
  authorization scope, and usage survives restarting the runtime.
- Unmeasured text follows AstrBotX's Chinese-character 0.6 / other-code-point 0.3
  estimator, floored per text part. Image inputs cost 765 estimated tokens whether
  a URL or inline data. This is a fallback estimate, not a tokenizer.
- First model calls use `compactAtTokens`. Subsequent calls within the same run
  only compact at the hard context window, after reserving instructions, tools,
  dynamic context and output space. SDK storage operations honor the same phase.
- `maxTurns` independently limits finished rounds. The current prompt and an
  in-flight tool chain are preserved. `trimTurns` controls the number dropped
  when the cap is crossed (`maxTurns - trimTurns + 1` retained finished rounds).
- `keepRecentRatio` defaults to 0.15 and accepts 0 through 0.3. A positive ratio
  preserves the newest whole round even if that round exceeds the ratio budget.
  The active request survives even with ratio zero. A small complete opening
  checkpoint (at most 20 percent of estimated source tokens) is retained; a large
  tool round may retain only its opening user messages as a safe anchor.
- `truncate_by_turns` skips the summary model and drops `trimTurns` oldest rounds.
  Semantic/extractive strategies preserve their existing failure behavior.
- Semantic requests preserve the full pre-compression role order and append a
  summary-only instruction naming retained opening/recent counts and the current
  task continuation. No executable tools are provided. Complete historical
  function chains remain paired; incomplete chains become quoted facts. Binary
  attachments become explicit placeholders. If the remaining token allowance
  forces trimming, the summary is told what was bounded, and opening/latest
  requests remain visible. The response still passes strict JSON validation.
- Every compression is checked again. If still too large, the oldest half is
  removed at whole-round boundaries, repeating until it fits or only the active
  round remains. An oversized indivisible request reports an explicit error.
- Full transcripts are never deleted by compression. Source hashes, before/after
  counts, strategies, fallback reasons and summaries are stored separately with
  Zod validation. A revoked scope or concurrent history mutation cannot publish
  a stale summary.

`targetTokens` remains readable for configuration compatibility and existing
summary-budget validation; recent retention now uses `keepRecentRatio` instead.

Tests: `tests/context-parity.test.ts` covers weights, inline/remote images, stale
usage rejection, restart reconstruction, cross-session isolation, hard-limit-only
storage behavior, turn limits, pending tools, opening anchors, recent context,
turn truncation and context-unit attachment. `tests/context-policy.test.ts`
continues to check real SDK integration and summary failure/authorization races.
