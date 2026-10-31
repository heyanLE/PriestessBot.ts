# Dashboard UX Wireframes

整理时间：2026-07-08

## 说明

本稿是 [dashboard-ux-interaction-draft.md](dashboard-ux-interaction-draft.md) 的低保真补充，用于把核心 UX 方案进一步落到页面结构与交互层。

本稿只定义：

- 页面框架
- 模块优先级
- 页面内跳转
- 列表/详情/操作布局
- 关键状态变化

本稿不定义：

- 最终视觉风格
- 配色、插画、品牌装饰
- 高保真排版细节

## 参考证据

本轮对 `hermes-agent` 的参考来自三类证据：

- `website/docs/user-guide/features/web-dashboard.md`
- `website/static/img/dashboard/*.png`
- `web/` 与 `apps/desktop/` 的前端结构和路由

另外，本轮后续已经通过临时 `Python 3.12` 环境、本地安装 `hermes-agent[web,pty]` 依赖、构建 `web` 前端，并在 `localhost:9120` 成功启动了 live dashboard。相关运行验证记录见：

- [dashboard-ux-live-validation.md](dashboard-ux-live-validation.md)

## 全局壳层

所有核心页面共享同一壳层。

### Desktop 壳层

```text
+----------------------------------------------------------------------------------+
| GLOBAL STATUS BAR                                                                |
| Health | Log Stream | Current Workspace | Last Updated | Last Apply | Refresh    |
+----------------------+-----------------------------------------------------------+
| PRIMARY NAV          | PAGE HEADER                                               |
|                      | Title | Summary | Scope chips | Page actions              |
| Overview             +-----------------------------------------------------------+
| Troubleshooting      |                                                           |
| Changes              |                 PAGE CONTENT                              |
| Assets               |                                                           |
|                      |                                                           |
| ---                  |                                                           |
| Secondary shortcuts  |                                                           |
| Recent validation    |                                                           |
| Last failed event    |                                                           |
+----------------------+-----------------------------------------------------------+
| FOOTER STATUS: websocket / stale data / selected object / keyboard hints         |
+----------------------------------------------------------------------------------+
```

### Mobile 壳层

```text
+------------------------------------------------------+
| Top status bar                                       |
| Health | Workspace | Refresh                         |
+------------------------------------------------------+
| Page header                                          |
| Title                                                |
| Summary                                              |
+------------------------------------------------------+
| Sticky segmented nav                                 |
| Overview | Troubleshoot | Changes | Assets           |
+------------------------------------------------------+
| Page content                                          |
| stacked vertically                                    |
+------------------------------------------------------+
| Floating action area when needed                      |
+------------------------------------------------------+
```

## Screen 1: 运行总览

### 页面目标

让用户在 10 秒内回答：

- 系统是否健康
- 最近是否有异常
- 当前正在跑什么
- 最近改动是否已经恢复

### 桌面线框

```text
+----------------------------------------------------------------------------------+
| TITLE: Runtime Overview                                      [Refresh] [Run Test]|
| Summary: Current operational state and newest operator signals                   |
+----------------------------------------------------------------------------------+
| CARD 1        | CARD 2         | CARD 3           | CARD 4                        |
| Overall       | Errors 30m     | Active Sessions  | Last Apply                    |
| Healthy       | 3              | 12               | Reload failed                 |
+----------------------------------------------------------------------------------+
| CARD 5        | CARD 6                                                         |
| Providers OK  | Platforms Running                                               |
+----------------------------------------------------------------------------------+
| LEFT: Exception Queue                                | RIGHT: Effective Runtime    |
|------------------------------------------------------|-----------------------------|
| [Critical] Provider timeout      2m ago   [Open]    | Workspace: default          |
| [Warning] Workspace reload fail  6m ago   [Inspect] | Agent: main-agent           |
| [Info] Config applied            8m ago   [View]    | Provider: openai / gpt-x    |
| [Info] Tool denied by policy     9m ago   [Open]    | Tool policy: 42 enabled     |
|                                                      | Source trace: 3 overrides   |
| [Open Event Center]                                   | [Inspect Effective Runtime] |
+----------------------------------------------------------------------------------+
| LEFT: Recent Validation                              | RIGHT: Quick Sessions       |
|------------------------------------------------------|-----------------------------|
| Agent test: failed                                   | Session A   failed 1m ago   |
| Tool test: success                                   | Session B   active 3m ago   |
| Last rerun: 5m ago                                   | Session C   active 7m ago   |
| [Re-run validation]                                  | [Open Sessions]             |
+----------------------------------------------------------------------------------+
```

### 核心交互

- 点击摘要卡进入对应页面并自动带筛选条件
- 点击异常队列行进入事件详情，右侧保留当前上下文
- 点击生效运行摘要进入 `生效运行时`
- 点击验证模块进入 `Agent 验证台`
- 点击 session 进入 `会话与运行轨迹`

### 状态规则

- `healthy`: 首页主色调平稳，异常区为空态但不隐藏
- `degraded`: 首页仍可操作，异常队列显示 warning 优先
- `failing`: 首页顶部状态条和异常队列共同升级提示
- `unknown`: 所有关键摘要卡显示 `data unavailable`
- `stale`: 顶部状态条显示 `data stale`

## Screen 2: 事件中心

### 页面目标

把“发生了什么问题”变成统一入口，而不是让用户在日志、会话、配置页之间猜测。

### 桌面线框

```text
+----------------------------------------------------------------------------------+
| TITLE: Event Center                                     [Retry selected] [Export]|
| Filters: Severity | Type | Object | Time Range | Status | Search                 |
+----------------------------------------------------------------------------------+
| EVENT LIST                                             | EVENT DETAIL              |
|--------------------------------------------------------|---------------------------|
| [Critical] Provider unavailable                        | Title                     |
| object: provider/openai                                | Severity / Type / Time    |
| at: 14:22:03                                           | Summary                   |
|                                                        |                           |
| [Warning] Workspace reload failed                      | Related objects           |
| object: workspace/default                              | - workspace/default       |
| at: 14:18:51                                           | - provider/openai         |
|                                                        | - session/abc             |
| [Info] Config applied                                  |                           |
| object: config/runtime                                 | Recommended actions       |
| at: 14:17:11                                           | [Open Session]            |
|                                                        | [Open Logs]               |
|                                                        | [Open Effective Runtime]  |
|                                                        | [Retry / Reload]          |
|                                                        |                           |
|                                                        | Evidence timeline         |
|                                                        | 14:18 save started        |
|                                                        | 14:18 reload failed       |
|                                                        | 14:19 validation failed   |
+----------------------------------------------------------------------------------+
```

### 核心交互

- 默认按严重程度和时间排序
- 列表切换不刷新整页，只更新右侧详情
- 从详情直接跳会话、日志、生效配置和重试操作
- 事件处理完成后支持标记为 resolved 或静默归档

### 筛选默认值

- 默认显示最近 24 小时
- 默认包含 `critical + warning`
- 首页带参进入时继承来源筛选

## Screen 3: 会话与运行轨迹

### 页面目标

让用户能回答：

- 这个回答为什么会出现
- 中间调用了哪些工具
- 失败点发生在哪一步
- 当前配置修改是否真的影响到了执行链路

### 桌面线框

```text
+----------------------------------------------------------------------------------+
| TITLE: Conversation Run                                  [Replay Test] [Open Log]|
| Filters: Platform | Workspace | Status | Search                                  |
+----------------------------------------------------------------------------------+
| RUN LIST                                               | RUN DETAIL                |
|--------------------------------------------------------|---------------------------|
| Session abc  platform=telegram  failed                 | Header                    |
| updated 1m ago                                         | status / platform / user  |
|                                                        | workspace / provider      |
| Session def  platform=qq  active                       |                           |
| updated 4m ago                                         | Timeline                  |
|                                                        | user message              |
| Session ghi  platform=api  success                     | assistant plan            |
| updated 8m ago                                         | tool start: web_search    |
|                                                        | tool end: failed          |
|                                                        | fallback response         |
|                                                        |                           |
|                                                        | Injection trace           |
|                                                        | persona: helper-default   |
|                                                        | memory hits: 3            |
|                                                        | workspace: default        |
|                                                        |                           |
|                                                        | Actions                   |
|                                                        | [Run same input again]    |
|                                                        | [Open effective runtime]  |
|                                                        | [Open related event]      |
+----------------------------------------------------------------------------------+
```

### 详情结构

右侧详情建议分四段：

- Run meta
- Message transcript
- Execution timeline
- Injection trace

### 关键交互

- 点击 timeline 中的 tool event，可展开原始参数和结果摘要
- 点击注入来源，可跳转 persona/memory/workspace
- 点击 `Run same input again`，自动把当前上下文带到 `Agent 验证台`

## Screen 4: 生效运行时

### 页面目标

让用户先看到结果，再决定是否追源码和配置层。

### 桌面线框

```text
+----------------------------------------------------------------------------------+
| TITLE: Effective Runtime                                 [Preview Change] [Edit]  |
| Scope: workspace=default | agent=main | provider=openai                         |
+----------------------------------------------------------------------------------+
| RESULT SUMMARY                                          | SOURCE TRACE             |
|---------------------------------------------------------|--------------------------|
| Workspace: default                                      | providerName             |
| Agent: main-agent                                       | root config              |
| Model: gpt-x                                            | overridden by workspace  |
| Tool policy: 42 enabled / 3 denied                      |                          |
| Personas: helper-default                                | workingDirectory.path    |
| Memory policy: max 5                                    | env override             |
| MCP servers: 2 enabled                                  |                          |
|                                                         | maxInjectedMemories      |
| [Open workspace detail]                                 | db layer                 |
| [Open provider asset]                                   | overridden by request    |
+----------------------------------------------------------------------------------+
| CONFIG IMPACT SUMMARY                                   | QUICK ACTIONS            |
|---------------------------------------------------------|--------------------------|
| Last reload: failed 6m ago                              | [Reload workspace]       |
| Previous snapshot retained: yes                         | [Open validation bench]  |
| Diagnostics: 2 warnings                                 | [Open raw config]        |
|                                                         | [Compare backup]         |
+----------------------------------------------------------------------------------+
```

### 核心交互

- 默认展示结果摘要，不默认展开 JSON
- `Source trace` 支持逐项解释“值从哪里来，被谁覆盖”
- 修改入口应先进入变更预览，而不是直接保存
- 保存后自动建议跳到 `Agent 验证台`

### 关键信息必须可见

- 当前值
- 来源
- 是否被覆盖
- 最近是否 reload 成功
- 失败后是否保留旧 snapshot

## Screen 5: Agent 验证台

### 页面目标

让配置维护者在修改后不离开 dashboard 就能完成回归验证。

### 桌面线框

```text
+----------------------------------------------------------------------------------+
| TITLE: Agent Validation Bench                            [Use current run input]   |
| Context chips: workspace | agent | provider | persona | memory scope             |
+----------------------------------------------------------------------------------+
| LEFT: INPUT / CONTEXT                                   | RIGHT: RESULT / EVENTS   |
|---------------------------------------------------------|--------------------------|
| Test message                                            | Result status            |
| ------------------------------------------------------  | success / failed         |
| "Please summarize..."                                   |                          |
|                                                         | Final response           |
| Workspace selector                                      | -----------------------  |
| Agent selector                                          | ...                      |
| Provider selector                                       |                          |
| Session/User context                                    | Execution events         |
|                                                         | tool start               |
| [Run validation] [Reset]                                | tool end                 |
|                                                         | provider response        |
|                                                         |                          |
|                                                         | Trace summary            |
|                                                         | provider=openai/gpt-x    |
|                                                         | tools used=2             |
|                                                         | persona=helper-default   |
|                                                         | memories injected=3      |
|                                                         | elapsed=2.4s             |
|                                                         |                          |
|                                                         | Next actions             |
|                                                         | [Open related logs]      |
|                                                         | [Pin as regression case] |
|                                                         | [Back to overview]       |
+----------------------------------------------------------------------------------+
```

### 验证模式

建议支持三种模式：

- Quick validation
- Replay previous failure
- Scoped validation

### 运行后反馈

运行完成后，不只给一句结果，至少显示：

- status
- final content
- events
- injection trace summary
- provider/model
- elapsed time

## 资产页通用模板

`Providers`、`Tools & MCP`、`Platforms`、`Plugins`、`Persona & Memory`、`Knowledge` 推荐复用一套模板。

### 线框

```text
+----------------------------------------------------------------------------------+
| TITLE: Asset Page                                            [Primary action]     |
| Filters: search | status | source | workspace | capability                      |
+----------------------------------------------------------------------------------+
| OBJECT LIST                                              | OBJECT DETAIL           |
|----------------------------------------------------------|-------------------------|
| name / status / tags                                     | basic summary           |
| name / status / tags                                     | current state           |
| name / status / tags                                     | source / scope          |
|                                                          | recent errors           |
|                                                          | related actions         |
|                                                          | [Edit] [Validate]       |
|                                                          | [Open troubleshooting]  |
+----------------------------------------------------------------------------------+
```

### 通用交互

- 单击行更新详情
- 双击或主 CTA 进入深层页
- 详情区必须能跳到 `变更` 和 `排障`

## 响应式约束

### Tablet

- `列表 + 详情` 仍保留，但详情宽度缩小
- 顶部摘要卡从 4 列降到 2 列

### Mobile

- 所有 `列表 + 详情` 改成两层结构
- 第一层是列表
- 第二层是详情抽屉或单页详情
- 验证台改成上下布局

### 不允许出现

- 横向滚动才能完成主任务
- 关键 CTA 被折叠进不可见区域
- 状态只靠颜色表达

## 页面间跳转规则

### 从总览出发

- 异常卡 -> 事件中心
- 会话卡 -> 会话与运行轨迹
- 生效摘要 -> 生效运行时
- 验证摘要 -> Agent 验证台

### 从排障回到变更

- 任意事件或 run detail 必须能直接跳到：
  - 生效运行时
  - 相关资产对象
  - Agent 验证台

### 从变更回到验证

- 任意会影响运行行为的保存、reload、启停，完成后必须有：
  - `Run validation now`
  - `Back to overview`

## 交付建议

如果下一轮进入 UI 设计，优先顺序建议是：

1. 运行总览
2. 事件中心
3. 会话与运行轨迹
4. 生效运行时
5. Agent 验证台
6. 资产页通用模板

这 6 块先稳定，整套新 `dash` 的 UX 基本就锁住了。
