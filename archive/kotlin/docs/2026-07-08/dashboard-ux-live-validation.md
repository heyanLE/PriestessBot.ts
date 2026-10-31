# Dashboard UX Live Validation

整理时间：2026-07-08

## 目的

本稿记录对 `hermes-agent` dashboard 的 live 验证结果，用于补强 `PriestessBot` 新 dash UX 稿的证据链。

主稿与线框稿见：

- [dashboard-ux-interaction-draft.md](dashboard-ux-interaction-draft.md)
- [dashboard-ux-wireframes.md](dashboard-ux-wireframes.md)

## 本次实际运行方式

由于本机系统自带 `python3` 为 `3.9`，无法直接运行 `hermes-agent`，本次采用以下方式完成 live 验证：

1. 使用 Codex bundled Python `3.12.13`
2. 在 `/private/tmp/hermes-dashboard-check/venv` 创建临时虚拟环境
3. 安装 `hermes-agent[web,pty]`
4. 在 `hermes-agent` 仓库内执行 `npm install --workspace web`
5. 执行 `npm run build -w web`
6. 使用独立 `HERMES_HOME=/private/tmp/hermes-dashboard-home` 启动：

```bash
python -m hermes_cli.main dashboard --no-open --port 9120
```

本次验证未污染 `PriestessBot` 工作区，`hermes-agent` 相关依赖和运行态均落在临时目录或其仓库内。

## Live 服务确认

运行后实际可访问：

- `http://127.0.0.1:9120`
- `GET /api/status`

空配置实例返回的关键状态包括：

- `gateway_running: false`
- `active_sessions: 0`
- `auth_required: false`
- `config_path: /private/tmp/hermes-dashboard-home/config.yaml`

这说明本次打开的是一个“干净机器级 dashboard”，非常适合作为 UX 壳层和空态验证样本。

## Live 观察结论

### 1. 根路由实际落到 `/sessions`

live 页面标题为：

- `Hermes Agent - Dashboard`

实际落点为：

- `http://127.0.0.1:9120/sessions`

这验证了之前从源码与文档中得出的结论：

- Hermes web dashboard 的默认首页不是聊天
- 它优先把用户带到“会话管理与系统概览”

### 2. 一层导航确实很长

live 页面可见的一层导航包含：

- Chat
- Sessions
- Files
- Models
- Logs
- Cron
- Skills
- Plugins
- MCP
- Channels
- Webhooks
- Pairing
- Profiles
- Config
- Keys
- System
- Documentation
- Kanban
- Achievements

这进一步印证了两个判断：

- Hermes 更像“大而全平台管理台”
- `PriestessBot` 新 dash 不应照搬其一层导航长度

### 3. Sessions 页面是“会话后台”，不是“工作中聊天页”

空配置实例下，`Sessions` 页显示：

- 总会话数
- Active in store
- Archived
- Messages
- `No sessions yet`
- `Start a conversation to see it here`

这说明 `Sessions` 的定位是：

- 会话台账
- 检索和管理入口
- 从历史回到对话的承接面

而不是当前工作主界面。

### 4. Config 页是高密度配置后台

live `Config` 页实际结构表现为：

- 左侧 section filter
- 右侧字段表单
- 顶部 `YAML` / `SAVE`
- section 数量很多，包含 `General / Agent / Terminal / Display / Delegation / Memory / Browser / Voice ...`

这验证了一个关键点：

- Hermes 的 `Config` 是重型后台页
- 它适合作为高级配置中心
- 不适合作为新 dash 的主首页模型

### 5. System 页是典型“系统总后台”

live `System` 页聚合了：

- Host
- Nous Portal
- Skill curator
- Gateway
- Memory
- Credential pool
- Operations
- Checkpoints
- Shell hooks

并且直接提供：

- `Check for updates`
- `Update now`
- `Start / Restart / Stop`
- `Run doctor`
- `Security audit`
- `Create backup`

这说明 Hermes 把“系统控制动作”高密度地收在一个总后台里。

对于 `PriestessBot` 的启发是：

- 这些重型管理动作可以存在
- 但不应与运行总览抢默认首页

### 6. 壳层层级比截图更清晰

从 live 空态看，Hermes web dashboard 的视觉和结构层级非常明确：

- 左侧是长导航与系统状态
- 中间才是主工作区域
- 空态也会保留所有全局管理能力

这说明它的壳层优先级是：

- 机器级管理
- 系统能力遍历
- 然后才是具体对象内容

这和 `PriestessBot` 新 dash 要做的“运维工作台首页优先”不是同一个目标。

## 对新 dash 的回写结论

基于 live 验证，保留以下借鉴：

- 默认首页必须是实际工作区，不是说明页
- 全局壳层要稳定表达系统状态
- 会话、日志、系统控制之间应可快速互跳
- 高密度后台页可以存在，但应降级

基于 live 验证，明确不照搬以下内容：

- 不照搬 Hermes 的超长一级导航
- 不照搬 `Sessions` 作为新 dash 的默认首页
- 不照搬 `Config` 作为主入口
- 不照搬 `System` 总后台抢占一线巡检位置

## 最终判断

`hermes-agent` 的 dashboard 更适合作为：

- “机器级后台 / 平台管理台”的参考

而 `PriestessBot` 新 dash 应该在此基础上继续收敛，转向：

- “运行态优先的 agent 运维控制台”

这与主稿中提出的四组信息架构完全一致：

- 总览
- 排障
- 变更
- 资产
