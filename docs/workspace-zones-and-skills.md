# 会话工作区与 Skill 管理

文件工具使用同一套路径。相对路径（例如 `report.txt`）和 `/workspace/files/report.txt` 都指向当前会话的隔离区。`/workspace/shared/report.txt` 指向执行环境的共享区。其他绝对路径、`..`、反斜线和跨区链接均拒绝。

| 区域 | 范围 | 普通干员 | 资深干员 | 高级资深干员 |
| --- | --- | --- | --- | --- |
| 隔离区 | 平台实例、会话类型、会话 ID、Agent、重置代次 | 读 | 读、写 | 读、写 |
| 共享区 | 同一个执行环境 | 读 | 读 | 读、写 |

以上操作还须满足工具装配、当前授权与资源边界。高级态也不会获得宿主 root 权限。群内发送者共用该群会话的隔离区。子 Agent 使用父会话的代次标识。不同群、私聊、Agent 和重置代次相互隔离。共享区不会随会话重置而清空。

Docker 两种后端均挂载 `/workspace/files` 和 `/workspace/shared`。低态的共享目录使用只读挂载。服务端对共享写入再次检查高级态及 `resources.manage`，不能仅凭提示词放行。低态的受限命令仍只接受隔离区内的相对路径；读取共享资料使用文件工具。本机后端的文件工具也接受上述别名，但 Shell 仍使用真实工作目录；本机执行不是 OS 沙箱。

## Skill 工具

每区的技能都存放在 `.agent/skill/<name>/`。目录名使用小写字母、数字和连字符。`SKILL.md` 须包含 YAML `name` 和非空 `description`，name 与目录名一致。单个技能文件最多 64,000 字节。

| 工具 | 操作 |
| --- | --- |
| `list_skills` | 浏览隔离区、共享区和已装配的外部库。返回 `library`、`path`、说明和 `writable`。 |
| `read_skill` | 按返回的 library/path 读取说明或引用文件。 |
| `write_skill` | 创建或替换一个文本文件。默认拒绝覆盖；明确 `overwrite=true` 才替换。 |
| `delete_skill_file` | 删除一个普通文件。删除 SKILL.md 后该技能不再被发现；其他文件保留。 |

写入参数 `libraryId` 仅接受 `isolated`、`shared`。路径例如 `weekly-report/SKILL.md`，不要重复加入 `.agent/skill`。有效的 SKILL.md 写入后，下一次浏览即可发现，无须重启或修改技能库配置。人格技能白名单仍然生效。

已配置的外部技能库保持只读并保留原 ID；现有库仍可浏览和读取。写在 `skills/...` 等其他位置的文件不会自动成为技能。工具不执行脚本，也不自动安装依赖。

服务启动时在共享区安装内置 `skill-packager`，即“封装 skill 的 skill”。它使用上述接口指导选择区域、编写说明、加入必要资源、检查依赖和验证结果。只创建缺失文件，不覆盖用户的有效修改。发布包只携带这个经过白名单选择的资源。

## 明确的错误与依赖说明

文件失败包含 `invalid_path`、`not_found`、`forbidden`、`size_limit`、`patch_mismatch` 或 `file_unavailable`。Skill 写入另有 `invalid_skill` 和 `already_exists`。模型据此修正参数，不能把未知失败归因于网络或权限。

进程操作使用 `exec_command` 返回的 **id** 作为 **session_id**。工具调用 ID、任务 ID、长结果 ID 均不是进程 ID。非零 exitCode 表示命令失败；轮询到 failed 不代表轮询接口发生故障。

Shell 默认 `/bin/sh`。需要 Bash 语法时显式调用 bash。先检查命令和 Python 模块；使用 python3 与工作目录内的虚拟环境。本次不自动安装 Pillow、NumPy 或 PyYAML，也不绕过系统 Python 的包管理限制。

文案采用 [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf) 的清晰表达原则：短句、主动语态、一句一个动作、统一术语、先说明条件。工程标识符和中文管理文案保留，不宣称完整词典或认证合规。
