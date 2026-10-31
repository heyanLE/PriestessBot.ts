# 工作区与 Skill 发布验收（2026-10-31）

最终 NAS 版本：`/home/heyanhub/apps/priestess/releases/20261031-workspace-zones-2`。
发行包 SHA-256：`9aba96c2d5537135edbb02a67592ed18a0d7bcc9939350e193d2bfc69cde660a`，180 个文件（含 manifest）。
最终备份：`/home/heyanhub/apps/priestess/backups/workspace-zones-20261031-110900`。
首次更新前 r16 备份：`/home/heyanhub/apps/priestess/backups/workspace-zones-20261031-110409`。

## 验证结果

- 完整后端 555/555，无跳过；前端工作流 71/71；严格 TypeScript、ESLint、前后端构建通过。
- 最后补齐群历史/长结果字段描述后，相关 30/30 回归及类型/ESLint 检查通过。发布 manifest 对比确认相对已验收版本仅变动两个工具说明模块。
- NAS 真实 `DockerSandboxClient` 临时目录测试通过：同群会话文件共享、跨会话读取隔离、两种路径别名、共享区低态 API 写/改/删拒绝、实际 Docker mount RW=false，以及绕过工具直达容器 Shell 的写入也被 OS 拒绝。
- NAS 同一测试覆盖内置 skill 发现、资深干员隔离区技能写入、跨会话共享技能读取、低态共享写拒绝和高级态删除。未调用真实模型，未发送真实 IM。
- 历史任务 `3d414202-e3c7-4fef-aa42-388aff8dcb5a` 与 `e0323aaf-6507-4ede-b1a8-aa951e458a8b` 的线上详情均返回正常，附件存在且公开记录无 `file/owner`。
- 最终 health=ok，NapCat `napcat4_18_6` connected；18 个 JS/CSS 资源和 Dashboard 入口返回正确内容。

## 配置与数据

配置 r16→r17 仅为已使用 read_skill 的 Agent 增加 `list_skills`、`write_skill`、`delete_skill_file`；正常同步递增配置和路由版本。人格未改，会话、聊天记录、记忆、知识库和秘密记录保留。

首次切换校验脚本漏算路由版本同步递增，触发代码自动回退。只读比较确认无额外设置差异后修正校验。重试幂等，不再递增版本；整个过程没有恢复旧数据库，也没有清空历史。

离线迁移读取运行记录识别 11 个旧工作目录，复制了 1 个可唯一对应的私聊目录，保留其原件。10 个旧群目录保留原位，没有把旧发送者隔离资料自动公开到新的群会话区域。没有未识别目录、冲突或失败复制。新群会话使用新的隔离区；如需旧文件，由管理员按照恢复清单选择恢复。

最后恢复清单：`/home/heyanhub/apps/priestess/data/workspace/.workspace-zone-migrations/1793444941528-5f55e765-8cdd-4a28-84ec-189e127fe4df-result.json`。该目录不挂载给模型。

`tools/migrate-workspace-zones.ts` 默认预览；执行需 `--apply --runtime-stopped`，SQLite 始终只读。不会覆盖目标目录或删除原目录。

## 实际边界

普通干员仍只读隔离区；资深干员可写隔离区；共享区写入仅限高级资深干员。工具装配、人格白名单、资源范围、实时授权和审批继续生效。

文件链接预检并非对并发高级态任意 Shell 修改的原子隔离承诺。共享区对低态的物理只读挂载是独立执行边界。本机 Shell 仍属于受信任宿主执行。

工具描述和错误码改善参数选择及失败后的处理，不会让失效的上游网页重新可用，也不会自动给执行镜像安装 Python 包。相关限制通过工具参数和运行环境说明提供给模型。
