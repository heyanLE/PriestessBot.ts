# Agent、IM 与平台资源配置（v3）

应用使用一个 `schemaVersion: 3` 的全局 JSON 文档。系统运行参数保持在 `runtime`；IM 连接声明在 `ims`，模型服务连接声明在 `llms`，独立 Agent 声明在 `agents`。Workspace 不再是可编辑的配置来源。

## 文件与数据位置

- `config.json`：系统设置、平台目录、IM、LLM、Agent 和共享资源目录。
- `platformDirectory/resources.sqlite`：平台人格与记忆记录。记忆通过 `libraryId` 分库，保留用户、会话、IM 和 Agent 作用域。
- `platformDirectory/<skillLibraries[].directory>`：平台 Skill 库。绝对目录按原值使用。
- `<agent.configDirectory>/skills/<name>/SKILL.md`：Agent 配置 Skill。
- `<agent.tempDirectory>/skills/<name>/SKILL.md`：Agent 临时 Skill。
- `runtime.database.path`：会话历史、提醒及执行链日志等系统运行数据。

平台目录和 Agent 的相对目录以全局配置文件所在目录为基准。系统数据库和插件路径沿用原系统配置语义。插件功能本次不扩展；平台目录可预留插件文件。

入口优先级为 `--config`、`PRIESTESS_CONFIG_PATH`、进程工作目录的 `config.json`。部署环境覆盖仅适用于已有的系统字段。API Key、IM Token 和 MCP 凭据仍通过环境变量引用，不写入配置快照的明文字段。

## IM 路由

每个 IM 实体有自己的连接参数、身份名单和路由表。同一种 IM 可以配置多个不同 ID 的实例。路由按照数组顺序取第一个启用且匹配的条目，没有匹配项就不调用 Agent。

匹配字段包括：

- `sessionTypes`：`GROUP`、`PRIVATE`、`CHANNEL`。
- `attention`：`ANY`（不要求）、`MENTION`、`REPLY`、`MENTION_OR_REPLY`、`NONE`。
- `attentionTarget`：`BOT`（机器人）或 `ANY`（任意对象）。
- `stripMentions`：匹配文本之前移除协议中的结构化 @；文本中的伪造 CQ 不会被解释为真实 @。
- `textMode`：`GLOB`（支持 `*`、`?`）、`PREFIX`、`EXACT`。
- `textPattern`：通配表达式、前缀或精确文本。匹配前去除前导空白。

目标类型只有 `AGENT` 和 `COMMAND`。Agent 目标必须引用已启用的 Agent；命令目标只能执行内置指令，并使用该路由的 `commandPrefix`。内置指令包括 `help`、`status` 和需要资深干员权限的 `new`；`new` 清理当前 IM 会话下各 Agent 的历史。

默认顺序为：群聊关注且 `#` 前缀进入命令；群聊关注进入默认 Agent；私聊 `#` 前缀进入命令；私聊进入默认 Agent。关注条件默认指向机器人，可在路由表中修改。`runtime.pipeline.wakingPrefix` 不再决定 v3 IM 的唤醒。

权限由每个 IM 的 `permission.superAdminIds`（高级资深干员）、`permission.adminIds`（资深干员）和普通干员默认值决定。消息正文不能授予角色。身份与最终命中的 Agent 会作为程序事实传入模型。

微信 iLink 的当前协议适配保留可靠的引用信息，但不猜测正文中的 `@名称` 是否属于协议级提及。群聊可按已知引用作者或不要求关注的路由配置处理。

## Agent 组合

每个 Agent 包含：

- `llm.providerRef`、`llm.model`、`llm.generation`：服务连接、模型和生成参数。
- `context`、`execution`：真实历史压缩、人格示例 token 预算、工具结果预算、执行步数和超时。
- `configDirectory`、`tempDirectory`：两个独立目录。
- `skills.platformLibraries`、`skills.configuration`、`skills.temporary`：启用状态和最低装配权限。
- `memory.libraryIds`、`memory.writeLibraryId`、`memory.allowedScopes`、`memory.maxInjected`：记忆读取/写入范围。
- `personaId`：只选择一个平台人格；空值表示不装配人格。
- `mcpServerIds`、`toolPolicy`：选择平台声明的 MCP 服务器和工具。

同名 Skill 的优先级为临时目录、配置目录、平台库；多个平台库按挂载顺序处理，并显示覆盖诊断。先选择有效的同名版本，再检查权限，不会因为高权限版本不可用就回退到低权限版本。文档内容在一次执行中固定，后续修改从下一次请求生效。

Skill 管理工具只能操作当前 Agent 的配置或临时目录，默认临时目录；它同时要求工具管理权限与该来源的装配权限。平台库通过 Dashboard 管理。

平台内置工具使用持久化的 `toolPolicy.enabled` 开关表。工具代码中的 `defaultEnabled` 只在工具首次初始化时使用；已有开关不会随代码默认值改变。平台关闭的工具，所有 Agent 都不可调用。Agent 未单独关闭时使用平台已开启的工具，也可以为自己逐项关闭；改变一项不会关闭其他项，全部关闭也不会退回默认值。旧允许／拒绝列表和风险类别限制会迁移为明确开关。

每个 Agent 可在工具逐项设置最低调用身份：普通干员、资深干员或高级资深干员，保存为 `agents[].toolPolicy.minimumPermissionGroups`。配置只能提高工具要求，不能降低内置工具的硬性下限；当前消息发送者的 IM 身份必须满足两者中更高的一项。风险类别仅作为内部审计与保护标签，不是 Dashboard 的权限配置项。MCP 定义集中保存，只有选中的 Agent 装配对应运行资源。

## 人格与记忆

平台人格页只管理目录。Agent 的 `personaId` 是实际绑定来源，不再按最近更新时间猜测人格。被启用 Agent 引用的人格不能直接禁用或删除，需先解除绑定。

示例对话在系统提示中作为明确标注的虚构风格参考，不能作为用户经历、真实请求或已经执行的动作。示例按完整问答对控制 token 预算，不进入真实会话历史。上下文截断以真实用户轮次为单位，保留完整工具交换和当前请求。

记忆库采用可解释的检索增强方式：先过滤启用库与作用域，再按关键词、中文片段和已有相关性规则排名。没有隐式依赖额外向量服务。停用或未装配的库不能被自动注入，也不能通过记忆工具读写或按 ID 删除。

## Dashboard 与执行链

导航分为系统、IM、LLM、Agent、平台资源、系统日志和 LLM 执行日志。配置保存采用预览和 revision 检查，冲突保留草稿。`/api/config/v3` 是配置读写入口。

执行链 API 为 `/api/executions` 与 `/api/executions/{id}`，支持 IM（`platform`）、LLM（`provider`）、Agent、状态和会话过滤。每条链记录实际模型请求、输出、用量、工具调用/结果、耗时和终结状态。内容会脱敏且有明确体积限制；截断会在记录中标明。进程异常退出留下的运行中记录在重启后标记失败。

Provider、Agent、路由及资源选择支持按新版本生效，正在执行的消息保持原版本。服务监听、系统数据库、插件加载、IM 连接和平台数据库目录改变需要重启；Dashboard 会显示 `pendingRestartPaths`。平台目录迁移涉及整个资源集合，因此同次修改整体等待重启，避免数据库仍在旧目录而 Skill 提前切到新目录。技能目录内容在下次执行时扫描，修改后无需重启。

## 开发配置迁移

v2 首次启动会转换为 v3，直接替换全局配置，不创建备份。启用的旧 Workspace Agent 会转换为独立 Agent；同名 ID 加 Workspace 前缀。旧人格和记忆迁入平台数据库，记忆库 ID 沿用旧 Workspace ID；Agent 范围的记忆同步更新重命名后的 Agent ID。

旧 `config.yaml` 和 `mcpserver.json` 在成功转换后移除。禁用且缺少配置文件的 Workspace 不阻止迁移。旧平台连接会得到默认路由，已有关键词 Agent 路由会转成路由表；部署后应检查新路由是否符合当前使用需求。

这是开发阶段的单向迁移，不提供旧版本回退兼容。更新 NAS 前应停止旧进程，使用同一持久目录启动新发行包。迁移完成后检查 `/health`、Dashboard 配置预览、IM 路由测试和一次执行链。

NAS 可使用仓库根目录 `./deploy-nas.sh heyanhub@192.168.31.24 /home/heyanhub/apps/priestessbot` 更新已有 Docker 安装。脚本沿用现有容器的镜像、挂载、环境变量和网络，不生成配置备份，也不包含 SSH 密码。Windows 的 `deploy-nas.ps1` 转调同一 Bash 工作流，需要 Git Bash。
