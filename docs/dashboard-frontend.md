# PriestessBot Dashboard

当前前端位于 `dashboard/`，是接真实 API 的静态单页应用。没有独立 npm 依赖，旧 Vue Dashboard 已归档到 `archive/dashboard-vue-20261117/`。

## 构建

```bash
npm run build:dashboard
```

生产服务读取 `dashboard/dist`。`npm run build` 同时构建后端和前端。

## 开发

修改 `dashboard/index.html`、`dashboard/app.js` 或 `dashboard/styles.css` 后重新运行 `npm run build:dashboard` 并刷新页面。没有 Vite dev server。

## API

前端使用同源 `/api/ts/*`：登录、配置、IM 状态、Agent 记录、能力目录、workspace 三区、执行环境和人格列表。登录令牌来自服务端 `data/management-token`，登录后使用同源管理会话。

## 已支持

- 六个 Tab：工作台、智能体、IM、能力、资源、系统
- 登录 / 登出
- 读取配置、平台状态、运行记录、能力目录、workspace 三区
- 保存 Agent 的公开字段、启用状态、工具开关、资源绑定、人格绑定、上下文压缩、委派、记忆提取、示例对话、技能 allowlist 和运行限制
- Agent 模型测试
- 新建/删除 Agent
- IM 新增、编辑、删除和启停；支持 Telegram、NapCat、微信 iLink 的配置字段
- 运行记录详情、停止运行、工具审批、活动运行的进程列表/终止、导出运行记录和产物下载
- 资源页四个子页：Skill / MCP、人格、知识库、长期记忆
- 知识库导入、重建索引、删除和检索
- 平台能力配置：所有插件入口、专用设置表单、B 站扫码登录链接/本地二维码和轮询、订阅
- 模型服务、服务端密钥、网络搜索、原生扩展安装/启停、插件订阅
- 人格新建、编辑、删除
- 知识库/记忆库新建与删除
- 会话管理：搜索、查看消息、归档/取消归档、删除、导出
- 配置版本：恢复历史修订、导入配置 JSON
- 长期记忆新增、编辑和删除
- Skill / MCP 类型与区域筛选
- 导出当前配置

知识库/记忆库的文档级高级设置、会话继续对话和模型原文下载仍在逐步迁移。
