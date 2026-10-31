# 场景走读

日期：2026-06-26

这份文档用三个常见场景把前面的导读、速查和工作流串起来，方便第一次接手的人照着走一遍。

## 场景一：新增平台消息字段

### 目标

让平台适配器多传一个字段，并让后续链路能用上它。

### 走读顺序

1. `message-flow.md`
2. `navigation-map.md`
3. `platform.md`
4. `pipeline.md`
5. `change-recipes.md`
6. `feature-delivery-workflow.md`

### 需要改哪里

- 平台 adapter
- `MessageEvent` 映射
- 必要时调整 pipeline 阶段
- 必要时回填 `message-flow.md`

### 交付检查

- 新字段能进入统一消息模型
- pipeline 能读到这个字段
- 回复路径没有断

## 场景二：新增一个 LLM tool

### 目标

让 Agent 能调用一个新的工具。

### 走读顺序

1. `llm-flow.md`
2. `tool.md`
3. `provider.md`
4. `glossary.md`
5. `change-recipes.md`
6. `feature-delivery-workflow.md`

### 需要改哪里

- `tool` 下实现 `FunctionTool`
- `ToolController` 注册
- `ToolPolicy` 和 workspace scope
- 必要时更新 `llm-flow.md`

### 交付检查

- 工具能被列出来
- 工具能被执行
- 执行结果能回到 Agent 循环

## 场景三：让 workspace 规则生效

### 目标

让某个 workspace 只启用特定技能和工具。

### 走读顺序

1. `getting-started-architecture.md`
2. `workspace.md`
3. `module-collaboration-matrix.md`
4. `role-reading-paths.md`
5. `change-recipes.md`
6. `local-dev-and-verification.md`

### 需要改哪里

- `WorkspaceController`
- `skill` / `tool` / `persona` 作用域
- 如影响配置，再改 `config.md`
- 如影响主链路，再改横切页

### 交付检查

- workspace 快照正确
- 受限能力不会泄漏
- 相关页面说明一致

## 怎么用这份文档

- 先选场景。
- 再按场景去对应页面。
- 最后回到 `feature-delivery-workflow.md` 走完整交付链。

