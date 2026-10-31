# dashboard-enhancement — Dashboard 增强

在 v2 基础 Dashboard 7 个页面之上，增加 v2 高级功能对应的管理页面。

## 新增页面

### PluginMarketView — 插件市场

浏览远程插件市场，查看插件列表、详情、评分、版本。支持一键安装、卸载、启用/禁用。已安装插件列表的管理。

### SubAgentView — 子 Agent 编排

可视化编排多个 Agent 的关系。支持流程图画布，拖拽 Agent 节点，连线表示路由/Handoff/链式关系。实时预览编排结果。

### KnowledgeView — 知识库管理

管理多个知识库的创建、删除、文档上传、检索测试。显示索引状态和文档统计。支持多种向量存储后端的配置切换。

### SettingsView — 全局设置

系统级配置：HTTP 代理、日志级别、数据目录、备份策略。分散在各页面的全局设置统一收拢。

## 已有页面增强

- `AgentView`：增加 Agent 列表管理，支持配置多个 Agent、选择 Runner 类型（ReAct / External）
- `ToolView`：增加插件市场安装的工具管理
- `LogView`：增加日志导出格式选择、日志保留策略配置
