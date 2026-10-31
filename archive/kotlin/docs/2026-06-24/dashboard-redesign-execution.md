# Dashboard Redesign Execution Blueprint

整理时间：2026-06-24

本文是 Dashboard redesign 的执行蓝图。目标是让后续角色可以按模块继续推进，而不需要重新理解整体方向。

## 设计 Brief

使用 Product Design 插件工作流确认后的 brief：

- 产品：PriestessBot / PriestessBot Dashboard。
- 类型：全交互运维工作台。
- 首屏：真实 Overview 工作台，不做 landing page。
- 风格：VSC/Cube-inspired internal workbench，参考 `/Users/heyanle/Downloads/PRODUCT_DESIGN_STYLE.md`。
- 布局：紧凑顶部栏、摘要指标、筛选工具条、主表格/列表、右侧详情面板。
- 约束：白底、浅边框、8px radius、无渐变、无装饰背景、无嵌套卡片、状态必须有文字标签。

## 多角色协作分工

| 角色 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| Product Lead | 决定页面优先级、核心路径和延期项 | 当前 Dashboard 功能、v3 roadmap、用户反馈 | 页面路线图和优先级 |
| Product Design | 将风格文档转成具体界面规则，做 QA | `PRODUCT_DESIGN_STYLE.md`、role-specific-plugins/product-design | 设计规则、组件规范、QA checklist |
| IA / UX | 规划导航、页面信息层级和工作台结构 | 路由、API DTO、已有页面 | 模块图、页面结构、交互路径 |
| Frontend | Vue/Pinia/API 落地 | `dashboard/src` | 页面、样式、API client、构建验证 |
| Backend/API | 补齐 Dashboard API 缺口 | `src/main/kotlin/.../server` | DTO、routes、service、测试 |
| QA | 验证桌面/移动、状态、可访问性和回归 | 本地预览、构建产物 | 问题清单和验收结论 |

多角色工具在本轮受线程上限影响无法生成新 agent，因此由主线程按上述角色视角推进，并把分工固化在本文档中。

## 导航分组

| 分组 | 路由 | 主要任务 |
| --- | --- | --- |
| Runtime | Overview, Logs, Config | 看健康态、诊断、备份与全局配置 |
| Channels | Platforms, Providers | 管理接入平台和模型 Provider |
| Agent Ops | Agent, Sub-Agents, Tools, Workspaces | 调试 agent、路由、工具策略、workspace reload |
| Knowledge | Knowledge, Persona & Memory, Conversations | 管理知识、人格、记忆和会话排查 |
| Extensions | Plugins | 插件发现、加载、启停和 extension 观测 |

当前代码仍使用紧凑顶部 tab，后续可以把分组转成二级导航或 command palette，但首批不增加交互复杂度。

## 页面执行规格

### Overview

- 摘要：runtime status、running platforms、providers、enabled plugins。
- 主表：health components。
- 详情：runtime diagnostics、conversation/workspace 数量。
- 下一步：增加最近告警/事件聚合，支持选择事件更新详情。

### Agent

- 摘要：provider、model、max steps、tools。
- 主编辑区：Agent JSON draft。
- 测试区：chat request、response、events。
- 下一步：显示 persona/memory injection trace；保存失败要保留 draft。

### Tools

- 筛选：query、source、risk、enabled。
- 主表：name、source、risk、state、required params。
- 详情：description、policy、owner、required parameters、capabilities、status reason。
- 下一步：复制 schema / sample call，支持 workspace effective policy diff。

### Workspaces

- 主表：workspace name、state、snapshot、loaded time、reload action。
- 详情：agents、tools、skills、MCP、personas、memory policy、diagnostics、reload result。
- 下一步：reload plan diff 用更明确的 added/removed/modified 分组。

### Persona & Memory

- Persona：workspace + search、列表、详情、create/edit/delete。
- Memory：scope fields、type filter、list、save、search、delete、expire。
- 详情：persona prompt template、memory scope/tags、search score/match reason。
- 下一步：从 Agent 测试响应跳转到实际注入的 persona/memory records。

### Logs / Config / Sub-Agent / Knowledge

- 仍需下一轮页面级信息架构迁移。
- 保持现有功能可用，不为视觉统一破坏原交互。

## API 矩阵

| 页面 | API | 当前状态 | 缺口 |
| --- | --- | --- | --- |
| Overview | `/health`, `/api/config`, `/api/platforms`, `/api/providers`, `/api/tools`, `/api/workspaces`, `/api/conversations`, `/api/plugins` | 已接入 | 缺少聚合告警/事件 API |
| Agent | `/api/agent/chat`, `/api/config` | 已接入 | 已显示 persona/memory injection trace；可继续增强跳转到记录详情 |
| Tools | `/api/tools` | 已接入 | 缺少 schema copy 示例 API，不阻塞 |
| Workspaces | `/api/workspaces`, `/api/workspaces/{id}`, reload/resource 子路由 | 已接入 | 缺少更结构化 reload diff 展示字段 |
| Persona & Memory | `/api/personas`, `/api/personas/resolve`, `/api/memory`, `/api/memory/search`, `/api/memory/expire` | 已接入 | 前端尚未接 resolve 测试入口 |
| Logs | `/ws/logs` | 已有页面 | 需重做筛选和断线状态 |
| Config | `/api/config`, backups/reload/restore | 已有页面 | 需重做表单密度和危险操作确认 |

## 组件规范

- `panel`：页面级工作台块，白底、1px border、8px radius。
- `metric`：摘要指标卡，最多一行主数值和一行说明。
- `toolbar`：筛选和操作区，输入优先，按钮靠后，移动端自动换行。
- `table`：桌面密集扫描；640px 以下卡片化行。
- `detail-panel`：桌面 sticky 右侧 390px；移动端堆叠。
- `inline-status`：所有状态必须有文字；颜色只做辅助。
- `code-block`：浅灰底，可选择文本，用于 schema/prompt/evidence。
- `form-grid`：两列表单，移动端单列。

## 验收 Checklist

- [x] Product Design brief 已确认并落地到源码。
- [x] `role-specific-plugins` 已拉取到本机并作为参考源。
- [x] Dashboard build 通过。
- [x] Persona & Memory 首批 API client 和页面已接入。
- [ ] 本地 dev server 截图验证 1440、1024、390px。
- [ ] Logs / Config / Sub-Agent / Knowledge 完成同风格迁移。
- [x] Agent 测试响应展示 persona/memory trace。
- [ ] 导航分组如需要，升级为二级导航或更多菜单。

## 下一批任务

1. 迁移 Logs、Config、SubAgent、Knowledge 页面到同一工作台模式。
2. 用浏览器检查 390x844 是否无横向溢出。
3. 将重复的表格/详情/表单模式抽成轻量组件，减少页面重复。
4. 为 Persona & Memory 增加组件级前端交互测试，当前已有无依赖 smoke test 和后端 route 回归覆盖。
