# Persona example scenes

Example messages remain a backward-compatible flat `exampleDialogs` array. An optional `scene` title on the first user message starts an independent scene; subsequent pairs belong to that scene until the next marker. Unmarked legacy arrays retain one scene per question/answer pair. Markers on assistant messages are rejected. The limits remain 100 alternating messages and 100,000 content characters.

The editor supports scene titles, collapsing, moving and removing whole scenes, and adding/removing turns. Before editing legacy scene boundaries it materializes all existing boundaries so an edit cannot accidentally merge other examples. Agent previews display scene headings.

At the model boundary, scenes are encoded as JSON reference data inside the versioned `persona_examples` context anchor. They are no longer injected as 90 user/assistant conversation messages. The persona text is a separate `persona` anchor. The SDK input filter persists missing or changed anchors before the active request; unchanged versions are reused from history, deleted bindings emit revocations, and anchors removed by compaction are restored. Hashes are checked against the rendered body. Examples never become real assistant responses or tool evidence. Group runs still rebuild their private working history from authorized public dialogue; anchors are inserted once into that working history, never shared with private tool results.

Root instructions retain Agent behavior, message provenance and authority rules. Persistent message metadata comes before the temporary dynamic snapshot, then the user's own text and actual image/file parts. Dynamic retrieval is refreshed per model request without being persisted. Finalization uses the same root instructions and retained conversation, including the full persona anchors, images and balanced tool calls/results; it disables tools and appends a limit notice instead of creating a separate text-only summary request.

On 2026-10-26 (Asia/Shanghai), the user's supplied Fiammetta harness was revised into `personas/fiammetta.json`: 11 character scenes plus 6 practical task scenes, 45 question/answer pairs. Repetitive action narration and contradictory phrasing were reduced. Brevity is a casual-chat preference rather than a cap on technical explanations. Runtime truthfulness, per-sender identity and tool approval rules remain in effect.

NAS release: `/home/heyanhub/apps/priestess/releases/20261026-persona-scenes`. Persona revision 2 was updated through the revision-checked management API, retaining tool/Skill scopes, folder and other settings. Original persona backup: `/home/heyanhub/apps/priestess/backups/persona-content-20261025-163927/persona.json` (directory timestamp UTC). A separate pre-release database backup is also retained. The user's source harness file was not overwritten.

Validation: complete strict backend checks and 252 tests passed; targeted SDK example-injection tests (12) passed after adding multi-scene assertions; Dashboard strict checks and production build passed. Native browser inspection confirmed 17 scenes / 45 turns and the bound persona. Test conversation `人格场景自检` is separate from real IM conversations.

## 单 Agent 与回答剧本（2026-11-14）

恢复原版菲亚梅塔人格（17 个场景、45 组对话），统一使用 assistant。固定路由按显式规则或默认 Agent 分派。旧版 cascade 配置读取时丢弃，旧路由审计仍可查看。

回答剧本插件启用后，向装配 read_skill 的 Agent 提供 plugin-response-scenes 技能库和短索引。SKILL.md 由动态上下文注入，各参考文件由模型通过 read_skill 按需读取。停用插件会停止注入并拒绝继续读取该库。人格工具和 Skill 过滤仍生效。

剧本目录位于 resources/plugins/response-scenes/skills/response-scenes，包含时政、总结分析、解释题解、任务执行和生活交流。清晰表达规范借鉴 ASD-STE100、W3C 认知可访问性建议及社区 i-have-adhd 的部分表达方法。来源与适用边界见该技能的 references/sources.md。

已部署 NAS 版本 `20261114-scene-skill`，配置 r21。服务健康、NapCat connected，插件已对 assistant 启用。原有会话、消息、记忆和模型记录 ID 经备份对照保留。备份位于 `/home/heyanhub/apps/priestess/backups/20261114-scene-skill`。

验证通过 581 项后端测试、81 项 Dashboard 测试、类型检查、lint 和生产构建，本机 Docker 条件不足跳过 4 项。隔离真实模型合成任务完成 2 次 Skill 读取和 2 次模型调用，交付 99 字符总结。首次使用合成平台被白名单拦截，随后使用隔离 Dashboard 入口验证；测试未发送 IM 消息。

2026-11-14 发布 `20261114-scene-required`，配置仍为 r21。系统提示词增加条件必读规则，当前索引和 read_skill 可用时，每个新任务先读取所选剧本，闲聊也读取 chat.md，同一任务已读内容可复用。索引同步删除简单闲聊可跳过的表述。三个无 Skill 提示的普通合成请求经真实模型验证，分别读取 analysis.md 与 clear-writing.md、explanation.md、chat.md。服务健康且 NapCat connected，备份在 `/home/heyanhub/apps/priestess/backups/20261114-scene-required`。这是提示词遵循验证，尚未证明所有未来任务都会调用工具。
