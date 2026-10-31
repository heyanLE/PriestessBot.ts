# 常见改动速查

日期：2026-06-26

这份文档把常见需求直接翻译成改动路径，适合第一次动手的人。

## 改动配方

### 新增一个平台事件类型

1. 改 `platform/adapters/*`。
2. 检查 `MessageEvent` 映射。
3. 如需新处理顺序，改 `pipeline/stages/*`。
4. 更新 `message-flow.md`。

### 新增一个 LLM tool

1. 在 `tool` 下实现 `FunctionTool`。
2. 注册到 `ToolController` 或 builtin tools。
3. 确认 `ToolPolicy` 和 workspace scope 允许它。
4. 更新 `llm-flow.md` 和 `tool.md`。

### 新增一个 skill

1. 在 `skill` 下实现 `Skill`。
2. 通过 `SkillController.register(...)` 注册。
3. 确认 workspace 允许该 skill。
4. 更新 `skill.md` 和 `llm-flow.md`。

### 新增一个 provider

1. 在 `provider/adapters/*` 下实现 provider。
2. 接入 `ProviderController` 或配置注册。
3. 补测试和健康检查。
4. 更新 `provider.md` 和 `llm-flow.md`。

### 新增一个 workspace 资源裁剪规则

1. 改 `workspace/WorkspaceController.kt`。
2. 检查 `skill`、`tool`、`persona` 的作用域计算。
3. 如影响配置结构，更新 `config.md`。
4. 如影响链路，更新 `message-flow.md` 或 `llm-flow.md`。

### 新增一个长短期记忆能力

1. 改 `memory` 模块数据模型和控制器。
2. 通过 `MemoryCase` 对外暴露。
3. 如需 Agent 注入，再接 `persona` 或 `tool`。
4. 更新 `memory.md` 和 `llm-flow.md`。

## 动手前检查

- 这个需求有没有一个明确的 `Case` 入口。
- 这个需求会不会跨 `platform`、`pipeline`、`agent` 三层。
- 这个需求要不要更新横切流程图。
- 这个需求是否影响 workspace 或配置。

