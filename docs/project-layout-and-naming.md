# PriestessBot 目录与命名审计

2026-10-30 起，仓库根目录就是 TypeScript npm 工程。`apps/`、`packages/`、`tests/`、`tools/`、`deploy/` 与根 package.json 共同定义当前运行时；Dashboard 继续位于 `dashboard/`，直接引用根共享契约。

## 已整理

- 旧 Kotlin/JNI、Gradle、旧启动和部署脚本、旧配置、旧文档、Dashboard 原始快照归档到 `archive/kotlin/`。
- 根 README、Docker、Compose、CI、开发工具、前端依赖路径及 NAS 打包脚本使用新目录。NAS 发行包布局仍为 dist/dashboard 等运行目录，不包含归档。
- 当前 npm 包名为 `priestessbot`，前端包名为 `priestessbot-dashboard`；界面文案和自有 User-Agent 使用 PriestessBot。
- Kotlin 归档的 Gradle 发行名称、相关二进制路径和自有网络请求标识同步为 PriestessBot。旧工具链没有作为本次交付重新编译。
- 原本的未提交源代码与本机数据均已保留；凭据、数据、依赖和构建缓存有独立 Git/Docker 排除规则。

## 有意保留的来源与兼容字段

`astrbot` 的剩余命中经过分类，不作字符串全量替换：

| 位置/类型 | 保留原因 |
|---|---|
| 外部导入器 `tools/migrate-astrbotx.ts`、`packages/core/src/astrbotx-migration.ts` 及其测试 | 名称表示输入格式和真实数据来源，不是当前产品名。 |
| `astrbotx:*`、`astrbotx-archive-*`、`astrbotx-local`、`astrbotx-memory`、`astrbotx-skills`、`ASTRBOTX_*` 等历史键 | 已在部署数据中用于关联、授权、来源及密钥引用；直接替换会使原数据或凭据失联。本轮不迁移线上数据标识。 |
| `astrbot_plugin_*` 旧配置文件名与插件源链接 | 外部插件的实际名称。保留后才能导入旧配置并追溯来源。 |
| 许可证、版权署名、固定版本源码链接、协议对照与历史导入的发送者名称 | 必须准确表达第三方来源和历史事实，不能将其标成 PriestessBot 自有内容。 |
| 归档 JNI 的外部 fork 路径与 crate 名称、机器工作区绝对路径 | 指向实际外部目录或依赖。仓库整理不擅自重命名外部仓库、Git 远端或当前桌面工作区。 |

`/api/ts`、配置 discriminator `priestess-ts` 和既有 service/image ID 是运行兼容协议，本轮保持稳定。`typescript` 作为语言、依赖包和前端组件目录名称仍然有效；原后端 `typescript/` 顶层目录已移除。

## 验证

- 根目录 `npm run check`：473/473，0 跳过，类型检查与 lint 通过。
- Dashboard：54/54 工作流测试，严格 TypeScript/Vue 检查和生产构建通过。52 个旧页面/模块移出活跃目录前逐文件校验归档哈希，清单见 `dashboard/archive-removal-manifest.json`。
- 根目录 `npm run build` 及 `scripts/prepare-nas-ts-release.py` 成功；155 个发行文件的 manifest SHA-256 全部一致，归档、旧顶层路径、凭据与运行数据未进入包。
- 生产镜像 `priestessbot:root-layout`（Linux arm64，Node 22.22.2）通过鉴权401、Dashboard页面及资源、原生SQLite、PTY，以及重启后API/数据库持久化验证。测试临时容器及volume已清理。
- 真实本地HTTP服务、临时数据库与假模型的浏览器验收：登录可用；原绿色布局保留；`/legacy/agents` 重定向 `/agents`，`/rust` 重定向 `/flow`。未连接真实IM或模型；临时服务已停止。

本次整理与验收在本地完成，未切换NAS线上版本。工作区路径保持原位置，避免改写桌面项目定位、外部依赖与既有绝对路径。
