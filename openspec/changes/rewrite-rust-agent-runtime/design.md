## Context

2026-10-24：用户要求 Rust 重构，保留 Agent；参考 AstrBotX 的 Codex、code mode、并发、执行、多模态流式、记忆、知识库、多 Agent、IM；暂不做音频与语音；指令只做代码抽象；路由升级为可视化节点图。用户随后明确：没有具体 agentflow 参考项目；运行态由路由节点选择。

代码依据：当前工作区基线 ecdca07（含未提交改动），AstrBotX 基线 602a4863。当前 JNI 与本地 codex_for_astrbot 为 413f16a；AstrBotX pyproject 固定 7c41085。本地旧修订已提供 Rust Engine、code_mode_host、additional_context、工具响应和线程控制，但不能据此推断新版 scopes 等接口完全一致。实现前需检出并验证选定版本。

证据入口：
- `src/main/kotlin/com/heyanle/priestess/bot/config/model/ApplicationConfigurationDocument.kt`：Agent/资源模型。
- `src/main/kotlin/com/heyanle/priestess/bot/agent/codex/`：已有桥接经验与恢复策略。
- `/Users/heyanle/Desktop/project/AstrBotX/astrbot/core/agent/runners/codex/`：code mode、会话、动态上下文与记忆。
- `/Users/heyanle/Desktop/project/AstrBotX/astrbot/core/tools/computer_tools/`：执行后端、PTY、补丁。
- `/Users/heyanle/Desktop/project/AstrBotX/astrbot/core/knowledge_base/`：解析、检索与融合。
- `/Users/heyanle/Desktop/project/codex_for_astrbot/codex-rs/astrbot-py/src/engine.rs`：公开 Rust 引擎 API。

## Goals / Non-Goals

**Goals**：Rust 服务端；独立 Agent；由图选择运行态；可发布的路由图；Codex/code mode 首个可用引擎；图片/附件与流式链路；隔离执行；记忆、RAG、主动委派；逐批迁移 IM；保留管理与追踪能力。

**Non-Goals**：本期音频/实时语音；首版任意脚本路由和无限循环；JVM/Python 插件二进制兼容；把 code mode JS 宿主当作 shell 沙箱；一次发布所有 IM。Rust 化默认范围是服务端，Vue 前端继续使用。

## Decisions

### 1. Rust 直接接入，明确交付阶段

采用 Cargo workspace，建议初期 4 个 crate：`priestess-core`（域契约、策略、图与调度）、`priestess-codex`（fork 适配）、`priestess-adapters`（IM、存储、执行）、`priestess-server`（服务组合、管理 API）。模块稳定前不按每个类拆 crate。

Tokio 承担异步运行；HTTP 层建议 Axum，序列化 Serde，持久层 SQLite。具体依赖版本、迁移库与向量后端在 P0 spike 后锁定。Vue Dashboard 复用布局与资源编辑，新增图编辑器；画布库以节点端口、类型检查、键盘操作、撤销重做能力选型，不预先锁定品牌。

Codex Engine 作为 Rust 依赖，关闭 Python feature，使用公开 API；保留一层小型适配器屏蔽 fork 变化。发行包同时包含对应的 code-mode-host 以及选定执行后端所需组件。避免新增 JNI 或先移植整套 Kotlin loop；进程隔离作为故障验证结果驱动的部署选项。

### 2. Agent 是持久定义，运行态是一次执行的上下文

`AgentDefinition` 保留 id/name、engine、provider/model、instructions、persona、skills、memory libraries、knowledge bases、MCP/tools、config/work directories、budgets。Agent 不因进入另一个运行态而复制一份。

`RunContext` 保存 run/parent_run ID、可信消息身份、会话键、图版本、Agent 配置版本、运行态、运行态来源节点、有效权限、取消信号与预算。可信 sender/group/platform 字段不能由文本转换节点覆盖。

同一 Agent 可在普通干员态回答问题，也可在高级资深干员态执行允许的管理任务。Agent 资源选择与工具配置仍限制可用能力；高运行态不自动获得未装配的工具或库。

### 3. 路由节点是运行态授权来源

内部稳定标识建议 `operator` / `senior_operator` / `elite_operator`，显示名为普通干员态 / 资深干员态 / 高级资深干员态，按此顺序递增。新消息默认普通干员态，执行 `SetRuntimeState` 节点后按节点配置切换，可提升也可降低。身份字段仅供条件节点匹配；不再以 ADMIN 名单隐式覆盖图的决定。

运行态映射为服务端维护的能力集合，工具/指令声明能力需求，资源另有访问范围。授权是“运行态能力 ∩ Agent 装配与限制 ∩ 执行环境限制”。等级比较只用于明确的最低运行态要求，不能代替资源授权。

以下为待验收的初始权限模板，而非用户已定的完整权限表：

| 能力 | 普通干员态 | 资深干员态 | 高级资深干员态 |
|---|---|---|---|
| 对话、选定知识库检索、获准只读工具 | 允许 | 允许 | 允许 |
| 当前会话记忆读写 | 按 Agent 配置 | 按 Agent 配置 | 按 Agent 配置 |
| 隔离执行环境中的写入、PTY、受控副作用 | 默认关闭 | 可授予 | 可授予 |
| 跨会话/全局资源变更、管理类命令 | 默认关闭 | 默认关闭 | 可显式授予 |

图的编辑/发布使用独立管理端认证。聊天运行态即使最高，也不自动得到管理 API 令牌。发布时展示每个授予高运行态的路径和节点；所有工具实际调用再次校验。正文、模型生成参数、MCP 返回值不能制造可信 RunContext。

子 Agent 继承父调用运行态和有效权限，再与目标 Agent 资源限制求交，不能通过另一个 Agent 绕过限制。中途取消和授权撤销在调用前检查；若撤销，终止而不是偷偷改变已运行 turn 的身份。

### 4. 路由图是可执行配置，画布仅负责编辑

持久化 `RouteGraph {schemaVersion, id, revision, nodes, edges, entry, limits}`；每个 IM 绑定已发布版本。节点布局、缩放等 UI 数据独立于执行语义。后端节点注册表输出配置 schema、端口、能力需求和说明，前端据此生成编辑器。

第一版提供以下节点：

| 节点 | 作用 |
|---|---|
| IM Input | 接受统一消息事件 |
| Condition / Switch | 按平台、群、发送者、消息类型、提及、回复、文本等分支 |
| Transform | 修改模型输入、提取参数，保留原始消息与身份 |
| SetRuntimeState | 选择本次调用的三个运行态之一 |
| RateLimit / Deduplicate | 控制消息进入频率和重复投递 |
| Command | 调用代码注册的指令，输出 handled / unhandled / error |
| KnowledgeRetrieve / MemoryRecall | 根据明确资源引用检索并添加带来源的上下文 |
| Agent | 调用一个明确的 Agent，交给运行调度器 |
| Reply / End / Error | 直接回复、忽略或处理错误 |

条件分支具有明确优先顺序和 default/error 出口。首版 DAG 不允许任意循环、不提供隐式并行 fan-out；一个已接受的正常对话路径恰好到达一个 Agent。命令已处理、拒绝、限流和忽略属于显式终点；不会为了满足“最终 Agent”而多发一次模型请求。LLM 主动委派在 Agent 内部发生，不改变外层图的终点约束。

校验覆盖端口类型、节点配置、悬空引用、不可达节点、循环、缺省出口、资源权限和没有 Agent 的正常路径。节点名称不是权限标识，运行态值必须来自已注册节点及服务端发布版本。

先编译成不可变执行计划再发布；使用期望 revision 防止覆盖并发编辑，执行固定图版本与配置快照。节点 timeout、总 deadline、最大步数、输入/输出体积统一限额。重试仅限声明幂等的步骤；发送消息、执行命令等副作用默认不自动重放。

画布支持拖拽、连接、配置面板、撤销重做、保存草稿、校验、模拟输入、高亮执行路径、版本发布与回滚。模拟默认仅评估路由/策略；LLM、发送消息和写操作使用替身，明确开启实测时才调用真实后端。

示例：IM Input → 私聊/群聊条件 → 可信身份或业务条件 → SetRuntimeState → Command；handled → Reply/End，unhandled → 知识检索 → Agent。普通访客和管理员可以走同一 Agent，但由不同分支赋予运行态。

### 5. 指令是代码定义，执行与发送分离

建议契约：`CommandDefinition {name, aliases, argument_schema, required_capabilities}`；解析生成类型化 `CommandInvocation`；`CommandHandler::execute(context, args)` 产生 `CommandOutcome {status, reply, data}`。`reply` 是统一消息内容，可含文本、图片和附件，由回复层发送。

注册时拒绝名称/别名冲突；统一处理参数缺失、类型错误、引号、转义、余下文本、help 与权限错误。参数错误不执行 handler。指令副作用由执行层完成；回复失败不触发 handler 重跑。首版不做可视化命令作者系统、动态脚本或热加载命令插件。

保留 new/reset 等已用语义；会话重置同时释放对应 Codex thread，保留会话身份。新的停止命令需要可绕过正在等待的会话队列，否则不能及时取消。

### 6. Codex、code mode 与会话生命周期

`AgentEngine` 对外暴露统一 RunEvent 流与控制句柄，事件包括 started/text_delta/tool_started/tool_result/usage/completed/failed/cancelled。静态 instructions 与人格等动态 additional_context 分开；每次召回变化不能重建 thread。

线程键至少包括 IM 实例、chat/session、Agent ID；发送者和有效权限固定到 turn。每会话同时一个 active turn，其他消息在有界队列中；只有同调用者、同 Agent、同授权快照与兼容图版本的后续输入可以 steer。改变运行态后必须新建独立 turn，不能追加到旧高权限 turn。跨会话共享全局并发预算。

动态工具清单按本轮有效权限生成，code mode 仅加载授权工具；结果以结构化文本/图片/文件表示，超长结果存储后返回引用。工具实际执行必须绑定 run/turn/call ID，拒绝过期回调、重复副作用和跨身份使用。code-mode-host 进程不能自行决定权限。

线程 rollout 持久化并可恢复；模型/凭据/引擎不兼容变化才根据能力决定是否轮换，动态检索上下文不属于轮换条件。失败不可无提示丢历史；恢复失败明确反馈并记录原因。关闭先停止入口，再排空/取消 turn、子任务、PTY、事件泵与引擎。

### 7. 执行环境、多模态与平台壳

`ExecutionEnvironment` 提供 read/write/patch/exec/write_stdin/cancel/artifact 操作。本地受限目录用于受信任部署；多人写操作优先使用隔离环境，Shipyard 为可选后端。路径限制不等同 OS 沙箱，部署界面必须准确声明隔离能力。

PTY 会话绑定 Agent、会话、run 与运行态；列表、读取、写入和终止全部检查所有权。后台完成事件进入会话调度器，遵守队列与取消状态，不直接从 watcher 随意发起模型调用。完成事件去重，回调携带原请求来源。

消息使用 `ContentPart`：Text/Image/File/Reference；图片必须带可解析媒体信息，文件解析产物保留来源，不能丢成字符串占位。输入、工具输出、最终产物共用媒体存储与作用域检查。音频/语音明确暂不支持。

平台 trait 提供启动、接收、发送、编辑/流式更新、停止与能力声明。不支持编辑的平台按节流策略分段或发送最终完整消息，避免每 token 一条消息。幂等键关联原事件与发送结果，部分发送失败可追踪。

先 Telegram/NapCat/iLink；后续按 AstrBotX source 清单逐个移植 QQ 官方、Discord、飞书、钉钉、企业微信、Slack、Matrix/Satori 等适用协议（平台清单最终以实际源代码和接入需求确认）。Python 平台实现作为行为参考，不能直接成为 Rust adapter。

### 8. 长期记忆、知识库与子 Agent

长期记忆保存用户/会话/Agent/共享库作用域、来源、提取时间、置信度、失效与删除状态。采用 Codex 原生提取/整理能力时，由统一 MemoryService 管理权限和权威存储；禁止另建一套无法同步删除的隐式记忆库。先验证 fork 是否支持所需作用域/删除接口，缺失时由宿主提供记忆工具，标记降级而非开放共享全局写入。

共享记忆自动提升必须检查来源隐私与运行态能力；混合多人群聊不得自动提升为全局事实。显式获准的全局更正与自动提取分开审计。每次检索检查 Agent 选择的库与上下文作用域；索引、压缩缓存和原始记录的删除一致。

知识库提供异步导入（文本/Markdown/PDF，其他格式渐进支持）、文档版本、chunk、embedding、稀疏+向量混合检索、融合和可选 rerank。检索先做库/文档权限过滤，返回来源/页码/片段；embedding 维度与模型版本变化需重建索引。导入失败、删除、重试都有任务状态。

主动委派将目标 Agent、任务和有界上下文作为输入；只允许显式装配的目标。子 Agent 有独立会话、工具集、目录和预算，继承父权限上限；深度、数量和总 token/时间预算有界，父取消向下传播。子结果作为带来源的工具结果返回父 Agent；避免共享会话锁下父等子造成死锁。

### 9. 配置、持久化和前端接口

新配置建议 schemaVersion 4，新增 routeGraphs、runtimeStates、executionEnvironments，保留 agents/ims/llms/资源目录。凭据仍以引用解析，不写入图、trace 或 rollout 配置。新服务端生成可供 TypeScript 使用的契约，避免前后端手工复制枚举。

关键实体：AgentDefinition、GraphRevision、Run、Turn、ToolCall、CommandInvocation、Artifact、MemoryRecord、KnowledgeDocument/Chunk、ImportJob、Delegation。追踪关联图节点→Agent turn→工具/子任务→平台回复，并记录运行态选择节点。

## Risks / Trade-offs

- 同进程 Rust 原生崩溃可终止服务 → 验证关闭/取消/内存与异常边界，若隔离要求未满足则将引擎适配器部署为受控 worker；不声称 Rust 自动解决故障隔离。
- 路由能授予高运行态 → 发布权限单独管理；模拟展示授予路径，保留图 revision 与来源节点；执行时不能信任客户端传来的运行态。
- 当前 fork 版本与 AstrBotX 不一致 → P0 比对接口并固定提交，code-mode-host 必须同版构建。
- 功能范围大 → 按下面里程碑验证，不将框架骨架标记为完成重写。
- 技术栈迁移不兼容旧插件 → 先以工具/MCP 替代实际用到的插件能力，插件 ABI 单独设计。

## Migration Plan

1. P0：建立参考行为矩阵；固定 fork；验证 Rust Engine+code mode host+结构化工具的最小闭环，确认三态权限模板。
2. P1：实现域模型、运行态、命令抽象、配置/持久化与管理接口。
3. P2：实现无 UI 的图编译/运行/模拟，导入旧 routes 为等价条件图（旧角色名单转成显式条件和运行态节点）。
4. P3：Codex 生命周期、队列、steer、动态上下文、流式、图片/文件与工具回调。
5. P4：执行环境、PTY、Skills/MCP、记忆、知识库和主动委派，逐模块验收。
6. P5：路由画布与版本管理；Telegram/NapCat/iLink 实测；额外 IM 分批交付。
7. P6：新目录导入旧配置和数据库，生成逐实体迁移报告；原始数据保留备份。缺失引擎/插件的 Agent 显式禁用并解释；不可恢复的 Codex rollout 保留历史但提示新 thread。
8. 切换：旧服务停止接收后导出最终快照，再启新服务；同一 IM 不双消费。回退需停止新服务、保留新数据副本、恢复旧服务与其快照；新版本写入默认不反向迁移，明确回退窗口的数据差额。

旧 add-agent-type-model/add-codex-engine/add-im-tool-injection 等作为迁移证据，不自动归档或宣称完成；与新方案冲突的规范在对应里程碑交付后同步。

## Open Questions

- 三种运行态的具体能力模板尚待按业务细化；“由路由节点选择”已确认，不再待定。
- 是否要求首发保留 NORMAL/DEEPSEEK_HARNESS 引擎的行为兼容？当前计划先交付 Codex，旧引擎不静默替换。
- Rust 代码暂规划在本仓库 `rust/` 以保持迁移可比较；最终项目名称/独立仓库可后定。
- 本期额外 IM 的优先级；不阻塞当前三个平台迁移。


### 2026-10-25 presentation decision (9.9)

The user explicitly changed the primary reference from the old Kotlin formatter to AstrBotX, and selected readable QQ text by default with configurable document-to-image output. Telegram uses escaped MarkdownV2, private ephemeral drafts with a persistent final message, and group send/edit fallback. NapCat separates segmented, final and image modes instead of forcing code/table images. Incomplete Markdown remains mutable until a stable boundary; renderer output is bounded and shares the durable send ledger. The local Rust renderer is a bounded replacement for the optional text-to-image role, not a port of AstrBotX's Python/HTML rendering stack.
