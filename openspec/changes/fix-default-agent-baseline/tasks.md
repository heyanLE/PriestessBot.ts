## 1. Runtime defaults

- [x] 1.1 Raise `CompressionSettingsDocument.maxTokens` and `ExecutionSettingsDocument.maxSteps` defaults via a shared `AgentRuntimeDefaults` object.
- [x] 1.2 Mirror both values in `Agent` and in `dashboard/src/models/configV3.ts` `agentRuntimeDefaults`/`newAgent()`.
- [x] 1.3 Add a test asserting the configuration model, the compiled Agent, and the Dashboard factory report identical defaults.

## 2. System prompt composition

- [x] 2.1 Replace `ReActRunner.buildSystemPrompt()` string concatenation with an ordered list of named sections that omit empty entries.
- [x] 2.2 Move the Agent role document ahead of the Platform, Message Identity, Agent Directories, formatting and delivery sections.
- [x] 2.3 Remove the plain-text tool enumeration, the permission-denial text in the prompt, and the same override in the native tool schema; keep the available-skill and loaded-skill blocks.
- [x] 2.4 Add runner tests asserting role-document precedence, empty-section omission, absence of a tool enumeration, absence of permission-denial text, and presence of the skill blocks.

## 3. Route specificity and diagnostics

- [x] 3.1 Order migration-generated keyword routes by descending keyword specificity within one legacy priority.
- [x] 3.2 Add the `IM_ROUTE_UNREACHABLE` diagnostic for strict glob subsumption within one IM and session type.
- [x] 3.3 Add the `AGENT_DELEGATION_UNAVAILABLE` diagnostic for a migrated orchestrator Agent when no delegation capability is exposed, without rewriting its instructions.
- [x] 3.4 Add tests covering reachable/non-reachable route pairs, the strictly shadowed route, migration ordering, and the lost delegation role.
- [x] 3.5 Let warnings travel with the configuration value instead of discarding it: `ApplicationConfigurationSource.decode` treated every diagnostic as fatal, so the first warning would have blocked projection and activation.

## 4. Baseline and verification

- [x] 4.1 Give `config.example.json` a fallback Agent reflecting the new baseline, with a test that it validates and carries the baseline.
- [ ] 4.2 Update a deployed profile's fallback Agent: replace any routing instruction with an assistant role and align its step and context limits. Blocked on a decision, because `maxTokens`/`maxSteps` are persisted per Agent and the new defaults intentionally do not rewrite explicit operator values. The NAS Agent `pipeline-manual-agent` still runs `maxTokens=4096`, `maxSteps=6`.
- [x] 4.3 Run the full JVM test suite (371 tests, 0 failures, 2 live-integration skips) and the Dashboard production build.
- [ ] 4.4 Record before/after route selection and execution traces end to end. Health, release identity, jar checksum, served Dashboard asset and NAS route reachability are verified after deploy; a live IM message run is still outstanding.
