# 交接文档：Codex 接入与 Agent 类型模型

日期：2026-09-23
分支：`main`　最后提交：`8bcc572 chore(codex): add Telegram web smoke skill`

本文用于把"给 PriestessBot 接入 Codex / 重构成 Agent 类型模型"这件事交接出去。包含：当前进度、已锁定决策、未决问题、必须先行处理的风险、以及下一步顺序。

> **最新进展（2026-09-23）**：P5 已改为 JNI 直连 `codex_for_astrbot` 的公开 Rust `Engine`，不运行 `app-server`，不调用 Codex 登录。参考修订仍为 `413f16a571a7a24557e70250c0284c5bebdd8c3f`。P1 协议轴、内部 Responses 适配器及 Dashboard 选择器已落地。P2 已将配置面从 `preset` 迁为 `type`，保留旧字段输入兼容和内部 Agent 行为；服务器向 Dashboard 报告类型能力，外部 runner 接口已分离。P4 的路由工具模式已开放默认 `MULTI` 和显式 `NONE`，尚未实现的 `SINGLE` / `SKILL` 会被拒绝。JNI 桥接已在 macOS arm64 上通过编译、链接和 mock Responses 的 JVM 烟测，覆盖无登录回复、`MULTI` 轮次经 `ToolCase` 执行工具、下一轮 `NONE` 收窄工具、关闭后恢复持久 rollout；假 Token 在运行中和关闭后的 Codex 目录扫描中未出现。恢复测试曾因在约 2 MB 的 JVM 线程直接 `block_on` 触发原生栈保护崩溃，现已把 Codex 核心异步操作派到 16 MB Rust 工作线程并验证恢复通过。Kotlin runner 已实现按会话持久映射、同会话串行、跨重启恢复、模型／指令／凭据变化轮换；无法恢复旧 rollout 时会提示用户开始新会话。非法 JSON、已关闭句柄、超时中断、重复工具调用均有测试。Pipeline 已注入共享外部 runner 注册表；CODEX 默认关闭，只有显式设置实验开关、原生库路径及匹配 SHA-256 后才会注册并在 Dashboard 可选，关闭流程会在 pipeline 排空后停止 runner。NAS Linux 构建、技能交付、执行链日志、故障隔离和日志侧凭据审计仍待完成。下方旧的 app-server 叙述是历史状态，以 `openspec/changes/add-agent-type-model/design.md` 的决定 11 和 P5 任务为准。

> **补充验证**：本地实验模式已可在配置校验和 Koin 注册中启用 CODEX；`MULTI` 轮次的授权 `use_skill` 回调会把 Skill 正文返回模型，`NONE` 轮次仍不声明工具。执行链写入有界的 Codex 事件/工具记录和真实每轮 token 用量；两轮 mock Responses 请求累计 10 tokens，且没有伪造的 `llm.request` / `llm.response`。假 Token 未出现在本地烟测的 Gradle 输出与测试报告中。NAS 构建、故障隔离与完整生产审计仍是后续工作。

> **生命周期补测**：无效 JSON、重复调用 ID、过期 native 句柄、超时中断、一个会话等待时其他会话继续执行，以及挂起事件轮询期间关闭 native 引擎均通过测试。JNI 对 Rust 工作线程结果的等待上限为 120 秒。实时网络调用被取消时的行为、不可恢复的原生故障隔离与 NAS 目标架构构建仍待验证。

> **后续更新（2026-09-23）**：第 2.2 节的未提交工作树已作为 `ecdca07` 推送至 `origin/main`。`codex_for_astrbot` 是 Codex CLI 源码仓库；方案调用其本地 `app-server` stdio 子命令，不另设网络服务或端口。参考该仓库的 `413f16a571a7a24557e70250c0284c5bebdd8c3f` 后，确认其 app-server v2 集成测试已走通 `dynamicTools` 声明、`item/tool/call`、主机回复与模型继续生成；剩余验证是 PriestessBot 所用发行版 CLI 的黑盒兼容性。OpenAI Docs 还指出动态工具会随 thread 持久化，而此参考修订的 `thread/resume` 类型没有动态工具覆盖字段，因此 P5 必须实测所选 CLI 的重设能力；否则工具权限变化时应切换 thread，避免暴露旧的工具集合。具体进程复用、线程映射、双向 JSON-RPC 分发、权限与崩溃恢复约束见 `openspec/changes/add-agent-type-model/design.md` 的决定 11，以及更新后的 P5 任务。下文保留原交接时的状态快照供追溯。

---

## 1. TL;DR

- **通用运行时准备已完成**，当前代码树可编译（`./gradlew compileKotlin --offline` → exit 0）。
- **Codex 专属前置为 0%**：外部引擎缝、Agent 类型能力声明、provider 协议轴、Responses 协议全部未开始。
- **因此现在不能直接接 Codex。** 最短路径：P1 → P2 →（P3 / P4 可并行）→ P5。
- 两个**阻塞性状态问题**必须先处理：
  1. 大量实现从未提交，且被跟踪文件引用了未跟踪文件（切分支/checkout 会让构建断）。
  2. 有 **6 个已实现但未归档**的 OpenSpec 变更，会把后续变更的 spec 基线搅乱。

---

## 2. 代码与仓库状态

### 2.1 构建

```bash
GRADLE_USER_HOME="$PWD/.local-gradle-home" ./gradlew compileKotlin --offline
# 通过（exit 0）
```

测试：`src/test` 下 107 个测试文件。完整套件未在本次交接中运行。

### 2.2 git 状态（重要风险）

| 指标 | 数值 |
|---|---|
| `src` 文件总数 | 337 |
| `src` 被 git 跟踪 | 232 |
| `src/main/kotlin/.../config/model/` 被跟踪 | **0**（整个目录未跟踪） |
| 仓库未跟踪 / 已修改 / 已删除 | 109 / 130 / 29 |

**具体后果**：被跟踪的 `agent/Agent.kt` 引用了未跟踪的 `agent/preset/`。现在执行 `git checkout`、`git stash` 或切换分支都会让构建立刻失败，而且没有可比对的基线。

**建议**：任何 P1–P5 动工之前，先把当前工作树按主题提交（至少保证被跟踪文件不再引用未跟踪文件），否则后续跨配置模型、provider、工具、仪表盘、镜像的大改动无法二分定位回归。

### 2.3 工具链缺失

- `codex` 二进制：**不在 PATH**。
- `openspec` CLI：**未安装**。npm 上的 `openspec` 是 2019 年的无关包（`openspec@0.0.0`），`npx openspec` 报 "could not determine executable to run"。本次归档是手工按 OpenSpec 流程执行的（评估 delta → 同步主 specs → 带日期前缀移动 → 保留 `.openspec.yaml`）。
- 本机有 `node v22.22.2`。

---

## 3. 已实现的能力（通用运行时）

这些是"接入 Codex 之前"本来就要有的东西，已经落地：

| 能力 | 关键文件 | 归档状态 |
|---|---|---|
| v3 配置模型（独立 Agent / IM 路由 / LLM 连接 / 资源目录） | `config/model/`、`config/application/`、`pipeline/stages/ImRouteStage.kt` | 已归档 2026-09-23 |
| Agent 预设体系 | `config/model/AgentPreset.kt`、`agent/preset/AgentPresetDefinition.kt` | 已归档 2026-09-23 |
| 进程内 loop | `agent/runner/ReActRunner.kt`、`HarnessRunner.kt`、`ToolCallExecutor.kt`、`ToolCallScheduler.kt` | 已归档 2026-09-23 |
| 提示词组装 + 指令文档 | `agent/prompt/SystemPromptAssembler.kt`、`resources/AgentInstructionsDocument.kt` | 已归档 2026-09-23 |
| 上下文压缩 | `agent/context/ContextManager.kt`、`LlmSummarizationStrategy.kt`（内含 `ToolResultPruner`） | 已归档 2026-09-23 |
| 工具层 | `tool/ToolSchema.kt`（`riskLevel` / `guidance` / `parallelSafe`）、`ToolExecutor.kt`、`ToolPolicy.kt`、`ToolResultOverflowStore.kt` | 已归档 2026-09-23 |
| 权限模型 | `pipeline/PipelinePermission.kt`（OPERATOR / ADMIN / SUPER_ADMIN）、`ResolvePermissionStage` | 已归档 2026-09-23 |
| 执行链观测 | `observability/trace/`、Dashboard 执行链视图 | 已归档 2026-09-23 |
| 平台工具贡献 | `platform/Platform.kt:96 platformTools()`、`platform/PlatformRegistry.kt` | **未归档**（19/19 已实现） |

---

## 4. 未实现（Codex 的直接前置）

全仓库 grep 命中数为 0：

```
ExternalAgentRunner  0     AgentRuntimeScope  0     engineId  0
WireProtocol         0     wireApi            0     /responses  0
```

具体缺口：

| 缺口 | 现状 |
|---|---|
| 外部引擎缝 | 没有 `ExternalAgentRunner` / 引擎注册表；`AgentCase.runWithProvider` 仍强制要求 `provider: ChatProvider` |
| Agent 类型与能力声明（P2） | `AgentPreset` 仍只是"行为预设"，没有 engine / 协议 / 注入能力三个维度 |
| Provider 协议轴（P1） | `provider/adapters/openai/OpenAIProvider.kt:39` 仍硬编码 `/chat/completions` |
| Responses 协议 | 未实现（`add-openai-responses-provider` 仍是提案，0/28） |
| Route 级 IM 工具注入（P4） | `pipeline/stages/PreProcessStage.kt:280` 仍是 `snapshot.runtimeTools + platform.platformTools()` 无条件拼接 |
| 工具库 per-tool 设置（P3） | `ToolPolicyDocument` 只有 allow/deny/risk/enabled/permission-group，没有设置位 |
| P5 自身 | codex 二进制、镜像改造、conversation→thread 映射表、审批→权限组裁决、`dynamicTools` spike 全部未开始 |

---

## 5. 已锁定的设计决策

完整论证见 `openspec/changes/add-agent-type-model/design.md`。摘要：

| # | 决策 |
|---|---|
| D1 | `type` 取代 `preset` 成为配置面上唯一选择器；对内仍分两层：`engine`（INTERNAL/CODEX）+ `internalPreset`。改名**留在 schema v3 原地迁移**，不升版本 |
| D2 | 能力用**集合**声明（`llmProtocols`、`toolInjectionModes`），不用布尔；类型注册表要求每个类型必须声明协议集 |
| D3 | provider 拆**厂商轴**（`llms[].type`）与**协议轴**（`llms[].protocol`） |
| D4 | 协议有两个消费方：内部 loop 适配成 `ChatProvider`；外部引擎只取 endpoint + protocol + secret。密钥只走**一条受审计的解析路径**，绝不写进引擎配置文件或日志 |
| D5 | 工具注入挂在 **IM route**（`ImRouteActionDocument`），因为消息是注入的起点；注入形态是**每请求**决策，不能按 agent 快照缓存 |
| D6 | `SINGLE` 模式 = **一个 IM 平台一个 dispatcher**，action 表由平台自维护；代价是参数校验下沉到 dispatcher、权限粒度需把策略键扩展到能寻址 action |
| D7 | 工具库给默认、**agent 可覆盖**（按 key 合并）；**第一期不开放 agent 级凭据覆盖** |
| D8 | CODEX **保留** instructions / persona / skills，通过 app-server 的 developer-instructions 通道投递；skills 与 `SKILL` 注入模式合流到 Codex 原生 skill |
| D9 | 引擎原生工具**最高优先级、不抑制**；同名冲突校验期报错，能力重叠在校验期提示并在运维文档写死"原生动作不受 toolPolicy 约束" |
| D10 | 能力矩阵与 roster **由服务端下发**，前端不复制 |

评审阶段确认：A1（v3 原地改名）、A2（归档两个已实现变更，NAS 部署转运维待办）、A3（P1 吸收并删除 `add-openai-responses-provider`）。

---

## 6. OpenSpec 状态

### 6.1 本次新建

`openspec/changes/add-agent-type-model/` —— 总变更（proposal / design / tasks / specs），承载整体模型与 P1–P5 拆分。**不实现任何运行时**，任务进度 9/57。

新增能力规范：`openspec/specs/agent-type-model/spec.md`（8 条需求 / 30 场景，只写跨阶段的约束性不变量）。

### 6.2 今日归档并同步

| 变更 | 归档位置 | 同步进的主 specs |
|---|---|---|
| `rebuild-agent-im-configuration`（20/21） | `openspec/changes/archive/2026-09-23-rebuild-agent-im-configuration/` | 新建 `agent-im-runtime`（5 条）、`execution-trace-dashboard`（3 条） |
| `add-deepseek-harness-agent-type`（43/43） | `openspec/changes/archive/2026-09-23-add-deepseek-harness-agent-type/` | 新建 `agent-presets`（6 条）；`agent-loop` 追加 2 条（10 → 12）；`agent-im-runtime` 第 1 条改为 MODIFIED 版 |

未随归档处理：`rebuild-agent-im-configuration` 任务 5.4（NAS 部署验证）已单列为 `add-agent-type-model/tasks.md` 的 `2.4`，明确不是阻塞项。

### 6.3 已删除的提案

`add-agent-runtime-scope/` 与 `add-codex-agent-type/` 已删除。**二者此前是未跟踪文件，删除不可恢复**；存活内容已搬进 `add-agent-type-model/design.md` 的两节：

- `Preserved Evidence: the Codex engine` —— app-server vs `exec`/SDK 的取舍、协议事实、审批方法名、mock Responses 验证、CoKit 评估、运维约束、以及唯一未验证机制。
- `Preserved Decisions: runtime scope` —— `llm.providerRef` 仍必填、`ExternalAgentRunner` 是"一轮"契约、引擎收到同一份已过滤工具面、不做反向映射、注册先于首条消息、外部 run 不伪造 `llmRequest`。

### 6.4 已实现但未归档（需清理）

这些变更的任务已完成或接近完成，但仍留在 `openspec/changes/` 下，会污染后续变更的 spec 基线：

| 变更 | 任务进度 |
|---|---|
| `unify-configuration-model` | 57/57 |
| `add-platform-scoped-tools` | 19/19 |
| `add-weixin-platform` | 14/14 |
| `add-persona-example-dialogs` | 10/10 |
| `unify-tool-result-materialization` | 9/9 |
| `fix-default-agent-baseline` | 14/16 |

### 6.5 待处理提案

`add-openai-responses-provider`（0/28）—— 按 A3，由 P1 吸收后删除；Responses 映射与保真边界在 `add-agent-type-model/tasks.md` 的 `3.6` 承接。

---

## 7. 路线图

| 阶段 | 变更 | 覆盖 | 依赖 | 状态 |
|---|---|---|---|---|
| P0 | 归档已实现的前置 | — | — | 2 个已完成（其余见 6.4） |
| P1 | `add-provider-protocol-axis` | 协议轴 + Agent 按协议选型 | 无 | 未开始 |
| P2 | `add-agent-types` | 类型注册表、能力声明、外部 runner 缝 | P1 | 未开始 |
| P3 | `add-tool-library` | 工具库 + per-tool 设置 + 凭据引用 | 无（可并行） | 未开始 |
| P4 | `add-im-tool-injection` | route 级注入模式、单 dispatcher 契约 | `add-platform-scoped-tools`、P2、P3 | 未开始 |
| P5 | `add-codex-engine` | app-server 引擎 | P1、P2、P4 | 未开始（仅设计） |

逐阶段验收标准写在 `openspec/changes/add-agent-type-model/tasks.md` 第 3–7 节。

---

## 8. 未决问题

### 阻塞 P2 的（需先定）

- **A4**：CODEX 下字段有效性矩阵。已确认 `instructions` / persona / skills 保留；待定 `execution.maxSteps`、`execution.toolTimeoutMillis`、`context.compression`、`context.toolResults`、`memory`、`mcpServerIds`。
  建议**按字段**而非按字段组判定：
  - `execution.maxSteps` → **inert**（没有 `currentStep` 可计）
  - `execution.toolTimeoutMillis` → **生效**（注入工具仍由 `ToolExecutor` 执行）
  - `context.compression.*` → **inert**（压缩发生在我们不持有的 transcript 上）
  - `context.toolResults.*` → **生效**（注入工具结果仍走溢出/物化存储）
  - `context.personaExampleTokens` → **生效**
  - `memory`、`mcpServerIds` → 建议**保留**
  - 待你选：inert（保留值 + 明确提示）还是 rejected（配了就报错）。建议 inert。

### 各阶段开工前再定

- **B1**（P4）dispatcher 策略键：`tool#action` 还是 `{tool, action}` 对？建议 `tool#action`。
- **B2**（P4）route 配了目标类型不支持的注入模式：报错还是惰性默认？建议报错。
- **B3**（P5）注入工具与引擎原生工具同名：校验期报错，还是允许（原生赢）？建议报错。
- **B4**（P5）Dashboard 对"与原生能力重叠"的注入工具：隐藏还是告警？建议显示 + 告警。

### 只能等 P5 spike 才知道

- **D1** developer instructions 走 app-server 哪个字段、是否还需要 `baseInstructions`。
- **D2** skill 发现根：per-Agent `CODEX_HOME` / extra skills root / 生成的 skill 目录。
- **D3** 若 `dynamicTools` spike 失败，CODEX 注入模式收窄到 `NONE` / `SKILL` 是否接受（预案）。

---

## 9. 建议的下一步顺序

1. **整理并提交当前工作树**（见 2.2）。这是所有后续工作的前提。
2. **归档 6.4 的 6 个已实现变更**（逐个评估 delta → 同步主 specs → 移入 `archive/2026-09-23-*`）。
3. **定 A4**（只差一个 inert vs rejected 的选择）。
4. **开 P1** `add-provider-protocol-axis`，创建时吸收并删除 `add-openai-responses-provider`。
5. P1 落地后开 P2；P3 可与 P1/P2 并行。

---

## 10. 附录：关键事实

### 10.1 为什么选 `codex app-server` 而不是 `codex exec` / TypeScript SDK

- `@openai/codex-sdk` 是薄包装，spawn `codex exec --experimental-json` 并交换 JSONL。其 `ThreadOptions` 只有固定值（`sandboxMode` / `approvalPolicy` / `workingDirectory` / `skipGitRepoCheck` / `outputSchema` …），**没有工具注册位、没有审批回调**。
- `codex exec` 下 MCP 工具调用会因 stdin 关闭、审批提示读到 EOF 而被自动取消；唯一绕过是 `--dangerously-bypass-approvals-and-sandbox`，同时废掉 read-only 沙箱（openai/codex#24135，仍未关闭）。
- app-server 提供 `dynamicTools` + 服务端反向请求 `item/tool/call`，以及 `item/commandExecution/requestApproval` 等审批请求，是唯一能同时满足"工具桥接 + 权限裁决 + 可观测/可中断"的接口。
- 原生二进制（Rust，linux 为 `*-unknown-linux-musl` 静态，x64/arm64 都有）**不需要 Node**；只有用 SDK 才需要 Node ≥ 18。

### 10.2 唯一未验证的机制

`dynamicTools` 与 `item/tool/call` **只在 schema 与协议文档中被确认，没有端到端跑通过**；姊妹项目 deepseek-harness 的 `packages/subagent/subagent-codex` 虽然跑通了 app-server（0.153.4：initialize → thread/start → turn/start → 通知 → 审批 → turn/interrupt），但**完全没用 `dynamicTools`**（全仓库 grep 为 0）。

→ P5 必须以 spike 开头（`tasks.md` 7.2）：证明 `initialize(experimentalApi=true)`、`thread/start(dynamicTools=[…])`、模型发起 `item/tool/call`、`contentItems` 回填、`turn/completed` 收敛这五步。失败则收窄注入模式。

### 10.3 环境事实

| 项 | 现状 |
|---|---|
| Docker 基础镜像 | `eclipse-temurin:21-jre`（`Dockerfile:6`），**无 node、无 git、无 codex** |
| 本机 node | `v22.22.2` |
| 本机 codex | 不在 PATH |
| Codex 对 cwd 的要求 | 默认要求 git 仓库；Agent 配置目录通常不是，需要 `--skip-git-repo-check` 或装 git |
| app-server 稳定性 | 官方标注 experimental，已发生过破坏性变更（`wire_api = "chat"` 被移除） |
| Kotlin 第三方客户端 | CoKit（`io.github.vupoint.cokit`）当时为 `0.0.x`、基线 0.146.0、未建模 dynamic tool call、无 release、**Maven Central 搜不到** → 不可直接依赖 |

### 10.4 关键路径索引

| 用途 | 路径 |
|---|---|
| 总设计（决策 + 证据 + 矩阵） | `openspec/changes/add-agent-type-model/design.md` |
| 路线图与逐阶段验收 | `openspec/changes/add-agent-type-model/tasks.md` |
| 跨阶段约束性需求 | `openspec/specs/agent-type-model/spec.md` |
| Agent 配置模型 | `src/main/kotlin/com/heyanle/priestess/bot/config/model/ApplicationConfigurationDocument.kt` |
| 预设/类型注册表 | `src/main/kotlin/com/heyanle/priestess/bot/agent/preset/AgentPresetDefinition.kt` |
| Agent 分发点 | `src/main/kotlin/com/heyanle/priestess/bot/agent/AgentCase.kt` |
| provider 解析/门禁 | `src/main/kotlin/com/heyanle/priestess/bot/pipeline/stages/ProcessStage.kt` |
| 工具注入点 | `src/main/kotlin/com/heyanle/priestess/bot/pipeline/stages/PreProcessStage.kt:280` |
| 工具执行与策略 | `src/main/kotlin/com/heyanle/priestess/bot/tool/ToolExecutor.kt`、`ToolPolicy.kt` |
| OpenAI adapter | `src/main/kotlin/com/heyanle/priestess/bot/provider/adapters/openai/OpenAIProvider.kt` |
