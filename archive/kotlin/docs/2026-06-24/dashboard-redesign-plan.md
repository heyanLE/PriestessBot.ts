# Dashboard Redesign Plan

整理时间：2026-06-24

本文记录本次 Dashboard redesign 的项目分工、Product Design 插件导入/使用状态、模块拆分、可执行任务清单、验收标准与本轮落地进度。

## 目标

本次 redesign 目标是把现有 Dashboard 从“功能页面集合”推进为“高密度运维工作台”。首屏应直接进入可操作的系统总览，而不是介绍页或营销式页面。

设计风格参考 `/Users/heyanle/Downloads/PRODUCT_DESIGN_STYLE.md` 中的 VSC/Cube-inspired internal workbench：

- 白色页面背景与近白工作区。
- 轻边框、8px radius、无重阴影、无渐变、无装饰光斑。
- 紧凑顶部栏、模块导航、摘要卡片、筛选工具条、主列表/表格、右侧详情面板。
- 主色只用于选中态、主按钮、链接、焦点环。
- 状态、严重性、运行结果必须使用文字标签，不依赖纯颜色。
- 桌面优先支持扫描、比较和侧边详情；移动端垂直堆叠且不横向溢出。

## 多角色分工

| 角色 | 负责人类型 | 主要产出 | 备注 |
| --- | --- | --- | --- |
| 项目经理 / 文档 | 当前角色 | redesign 计划、任务拆解、验收口径、风险记录 | 负责保持任务边界清晰，不直接修改 Dashboard 代码 |
| 产品负责人 | 人类决策者 | 页面优先级、核心工作流确认、取舍决策 | 需要确认首批上线范围和是否保留原有 7 页面结构 |
| Product Design 插件 | 设计辅助角色 | 风格化界面方案、交互检查、设计 QA 建议 | 用于生成/审查工作台风格，不替代最终工程验收 |
| 前端工程 | 实施角色 | Vue 3 页面重构、组件拆分、状态管理、响应式适配 | 需遵守现有 Vite + TypeScript + Pinia 技术栈 |
| 后端/API 工程 | 协作角色 | Dashboard API 缺口补齐、DTO 稳定、错误语义统一 | 优先复用现有 Ktor API，不为纯视觉重构扩大后端范围 |
| QA / 测试 | 验收角色 | 桌面与移动截图核查、交互用例、错误/空态测试 | 重点覆盖真实运维路径和窄屏不溢出 |

## Product Design 插件状态

当前状态：

- 已有明确风格参考：`PRODUCT_DESIGN_STYLE.md`。
- 已使用 Product Design 插件流程：读取插件 index/get-context/user-context/prototype 规则，完成 brief playback，并以现有 Dashboard 源码 + 风格文档作为视觉约束推进。
- 已拉取用户指定仓库：`https://github.com/openai/role-specific-plugins` 到 `/Users/heyanle/Desktop/project/role-specific-plugins`。
- 已核对仓库内 `plugins/product-design/.codex-plugin/plugin.json` 与 README；该仓库提供 Product Design 插件技能、参考规则、模板与 marketplace 配置。
- 已尝试用 `codex plugin marketplace add` 导入本地 marketplace；当前 CLI 要求 marketplace 根目录包含受支持 manifest，而该仓库 manifest 位于 `.agents/plugins/marketplace.json`，直接传文件或 `.agents/plugins` 目录均未被当前 CLI 接受。因此本轮使用会话中已安装的 Product Design 插件缓存推进实现，并保留仓库作为参考源。
- 当前会话可用并实际使用的是本机已安装 Product Design 插件缓存：`/Users/heyanle/.codex/plugins/cache/openai-curated-remote/product-design/0.1.47`。
- 已运行 Product Design user-context preflight，当前无已保存的 Product Design 用户上下文。

使用顺序：

1. 使用 Product Design get-context 对齐 redesign brief。
2. 读取现有 Dashboard 页面和样式，确认源码即为本次 redesign 目标。
3. 使用多角色协作：主线程实现、设计 QA 子角色审查、文档/项目经理子角色整理计划。
4. 实现后用构建、响应式 CSS 检查和本地预览可达性验证收口。

设计 brief 摘要：

```text
Use the KgReviewSpace VSC/Cube-inspired internal workbench style.
Build a full-interactivity operational web app for PriestessBot Dashboard.
The first screen must be the actual workbench, not a landing page.
Use compact navigation, summary cards, filter toolbar, dense table/list, and right-side detail panel.
Avoid gradients, decorative blobs, nested cards, marketing hero sections, and color-only status.
```

## 模块拆分

### Shell / Navigation

目标：建立统一工作台外壳，承载顶部栏、模块入口、运行状态、用户/连接状态和全局操作。

范围：

- 顶部栏高度约 64px。
- 产品标识、Dashboard 名称、运行环境副标题。
- 紧凑模块 tab 或侧边导航。
- 图标按钮入口：刷新、日志、设置、API/帮助。
- 状态 pill：后端连接、WebSocket、当前 workspace。

### Overview Workbench

目标：首页展示系统运行态，能快速定位异常和进入细节。

范围：

- Summary cards：平台运行数、Provider 可用数、今日消息量、错误/告警数。
- 主列表：最近事件、消息、任务或错误。
- 右侧详情面板：选中事件的上下文、相关模块、时间线、原始数据。
- 支持搜索、状态筛选、时间范围筛选。

### Platform / Provider Operations

目标：把平台与 LLM Provider 运维入口统一为可扫描的配置与状态界面。

范围：

- 平台实例列表、运行状态、启停操作、配置摘要。
- Provider 列表、模型状态、连通性测试、错误详情。
- 操作失败时显示可恢复错误，不破坏当前布局。

### Agent / Tool / MCP Workbench

目标：支撑 Agent 配置、工具启用、MCP Server 状态和测试对话。

范围：

- Agent 配置摘要与测试入口。
- Tool / MCP 列表按启用、来源、策略状态筛选。
- Tool call 详情支持复制 schema、复制调用样例。
- 测试区保留真实对话与 tool observation 的可读结构。

### Persona / Memory Workbench

目标：把 v3 persona 与 memory 能力纳入 Dashboard 的可操作界面，方便配置注入人格、检索运行记忆、验证作用域。

范围：

- Persona 列表支持 workspace、搜索、启用态、Agent 绑定扫描。
- Persona 详情展示 tone、boundaries、system prompt template。
- Persona 表单支持创建、编辑、软删除。
- Memory 支持 workspace/scope 上下文字段、类型筛选、关键词检索、保存、删除、过期清理。
- 搜索结果在右侧详情中展示 score 与 match reason，辅助调试注入来源。

### Conversation / Logs

目标：增强排查效率，把会话和日志作为可过滤、可定位、可导出的运维数据。

范围：

- 会话列表、平台/时间/关键词筛选、消息详情。
- 实时日志流、级别筛选、暂停/恢复、清空、导出。
- 日志项与相关会话/Agent run 尽量建立跳转关系。

### Settings / Advanced Modules

目标：收拢全局设置和高级模块，避免把低频配置混入首屏。

范围：

- 全局配置、日志级别、数据目录、备份策略。
- Plugin market、Sub-agent、Knowledge 等高级页面按权限/成熟度分批进入。
- 所有危险操作需要确认态和可理解的结果反馈。

## 本轮已推进

- 已把全局 shell 从左侧栏改为紧凑顶部导航。
- 已重建 `dashboard/src/styles/base.css`：统一白底、近白页面、1px 边框、8px radius、系统字体、蓝色强调、状态标签、表格、详情栏、移动端规则。
- 已重构 Overview：首页改成 summary cards、组件表、右侧 Runtime Detail、最近会话表。
- 已重构 Tools：搜索/来源/风险/启用状态筛选，主表格 + 右侧详情。
- 已调整 Workspaces：工作区列表表格、行选择、reload 操作、右侧详情。
- 已调整 Agent：保留 JSON 配置和测试聊天，Provider/Tool 区域换成密集表格。
- 已调整 Platform、Provider、Plugin、Conversation 页面，统一表格容器和状态表达。
- 已新增 Persona & Memory 工作台：接入 `/api/personas` 与 `/api/memory`，支持列表、筛选、详情、创建/更新/删除、memory search 与 expire。
- 已吸收设计 QA 建议：顶部栏 64px、产品标识 36px、详情栏 390px、移动端表格卡片化、浅色代码块。
- 已运行 Dashboard build 并通过。

## 可执行任务清单

### Phase 0：范围确认

- [x] 确认本轮先覆盖 Dashboard 核心运维页面，并保留现有路由结构。
- [x] 确认视觉目标为 VSC/Cube-inspired internal workbench。
- [x] 核对 Product Design 插件可用状态和用户指定仓库。
- [x] 列出现有 API 与目标界面的字段缺口。

### Phase 1：设计输入

- [x] 将 `PRODUCT_DESIGN_STYLE.md` 转化为 Dashboard 专用设计 brief。
- [x] 使用 Product Design get-context 对齐 brief。
- [x] 以当前 Dashboard 源码为视觉目标进行工作台化实现。
- [x] 标注主要状态：loading、empty、error、success、disabled、offline。

### Phase 2：信息架构

- [x] 定义模块导航顺序与页面分组。
- [x] 定义 Overview 首屏信息优先级。
- [x] 定义右侧详情面板复用模式。
- [x] 定义筛选工具条、状态 badge、表格行的统一样式。
- [ ] 定义抽屉/弹窗的统一组件规范。

### Phase 3：前端实现

- [x] 建立 design tokens：颜色、字体、radius、border、spacing。
- [x] 实现 Shell、TopBar、Nav、SummaryCard、FilterToolbar、DataTable/List、DetailPanel 样式基线。
- [x] 重构 Overview 为真实工作台首屏。
- [x] 迁移 Platform、Provider、Agent、Tool、Conversation、Plugin、Workspace 页面。
- [x] 新增 Persona & Memory 页面并接入真实 API。
- [ ] 迁移 Log、Config、SubAgent、Knowledge 的页面级信息架构。
- [x] 保持 Vue 3 + Vite + TypeScript + Pinia，不引入大型 UI 框架。

### Phase 4：API 与数据

- [ ] 为每个页面确认数据来源、刷新策略、错误语义。
- [x] 为 Persona & Memory 确认 API 数据来源与基础错误反馈。
- [ ] 检查 WebSocket 日志流和健康状态在新 UI 中的连接/断开反馈。
- [ ] 保证 mock/空数据不会掩盖真实 API 失败。
- [ ] 为复制、测试连接、启停、保存配置等操作提供明确成功/失败反馈。

### Phase 5：QA 与发布

- [ ] 桌面截图检查：1440px、1240px、1024px。
- [ ] 移动截图检查：390x844，无横向溢出。
- [ ] 键盘可达性检查：导航、筛选、表格选择、抽屉关闭、主操作按钮。
- [x] 状态色检查：主要状态都有文字标签。
- [x] Dashboard build 通过。
- [x] 本地预览 URL 可访问。
- [ ] 回归检查：原有 Dashboard API、WebSocket、路由、打包路径可用。

## 验收标准

视觉验收：

- 首屏是可操作工作台，不出现营销 hero。
- 页面以白色和近白色为主，组件为轻边框平面表面。
- 卡片、面板、输入框、工具条 radius 不超过 8px。
- 无大面积渐变、装饰光斑、重阴影、嵌套卡片。
- 主色蓝只作为交互强调，不形成单色主题。

交互验收：

- 搜索和筛选能更新列表。
- 行选择能立即更新详情面板。
- 启停、连通性测试、保存、复制等操作均有成功/失败反馈。
- loading、empty、error、success 状态完整。
- WebSocket 断开、API 错误、无配置等异常状态可见且可恢复。

响应式验收：

- 960px 以下工作台区域垂直堆叠。
- 640px 以下表格转换为更适合移动端的列表/卡片行。
- 390x844 下无横向滚动，无文字按钮/状态 badge 溢出。
- 关键操作在移动端仍可见，不被隐藏到不可发现的位置。

可访问性验收：

- 所有交互控件可键盘访问。
- 焦点环清晰可见。
- 图标按钮有可理解的 label 或 tooltip。
- 状态不只依赖颜色表达。
- 抽屉/弹窗有标题、关闭按钮和合理焦点管理。

工程验收：

- 不破坏现有 Dashboard 路由、Ktor 静态资源服务和 `/api/*`、`/ws/*` 代理边界。
- 不引入与当前技术栈冲突的大型 UI 框架。
- TypeScript 类型检查通过。
- Dashboard build 通过。
- 关键交互有自动化或手工验证记录。

## 风险与约束

- 现有 Dashboard 页面较多，若一次性重构全部页面，QA 面会明显扩大。
- Product Design 插件可提供方向和 QA 建议，但仍需要工程侧按现有代码结构落地。
- 后端 API 若缺少聚合状态，Overview 可能需要临时组合多接口，需注意加载与错误状态。
- 高级模块如 Plugin market、Sub-agent、Knowledge 可能成熟度不同，建议按页面价值和 API 稳定性分批进入。
- 本轮已修改 Dashboard 代码，但未触碰后端与 OpenSpec 归档状态。

## 建议里程碑

| 里程碑 | 目标 | 完成信号 |
| --- | --- | --- |
| M1：Brief 冻结 | 风格、范围、首批页面确定 | Product Design brief 与页面范围被确认 |
| M2：首屏方案 | Overview 工作台桌面/移动方案完成 | 首屏结构、状态、交互路径可评审 |
| M3：组件基线 | Shell 与核心组件完成 | 新页面能复用统一 token 和组件 |
| M4：核心页面迁移 | Overview、Platform、Provider、Agent、Tool 完成 | 主要运维闭环可用 |
| M5：QA 收口 | 响应式、可访问性、构建和回归完成 | 验收标准全部通过或有明确延期项 |
