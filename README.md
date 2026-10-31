# PriestessBot

PriestessBot（普瑞赛斯）是基于 **TypeScript、OpenAI Agents SDK 和 Vue 3** 的 Agent 聊天机器人。支持 NapCat（QQ）、Telegram、微信 iLink，提供独立 Agent、人格、会话、记忆、知识库、工具、执行环境和绿色主题 Dashboard。

## 快速开始

需要 Node.js **22.18+**，建议使用已验证的 **22.22.2**。在仓库根目录执行：

```sh
npm ci
npm --prefix dashboard ci
npm run check
npm run test:dashboard
npm run build
PRIESTESS_CONFIG="$PWD/config.example.json" npm start
```

打开 <http://127.0.0.1:8081>。首次启动会在 `.runtime/management-token` 生成管理令牌，运行数据保存在 `.runtime/runtime.sqlite`。示例配置中的 IM 默认禁用；在 Dashboard 配好模型、机器人和授权后再启用。

开发时，后端使用 `npm run dev`，前端使用另一个终端运行 `npm run dev:dashboard`。前端开发服务默认连接本机 8081 后端，可用 `VITE_TS_PORT` 调整。

## 目录

```text
apps/server/          HTTP 服务、平台生命周期与运行装配
packages/contracts/  强类型 schema 与共享接口
packages/core/       Agent、授权、路由、会话、存储与记忆
packages/adapters/   模型 SDK、IM、工具、执行与外部服务
dashboard/          Vue Dashboard（独立 npm 锁文件）
tests/               后端与协议测试
tools/               迁移、验收和开发工具
deploy/              systemd 示例与执行环境镜像
scripts/             NAS 发行包构建
docs/                当前运行与维护文档
archive/kotlin/      旧 Kotlin/JNI、旧 Dashboard 与历史文档
```

旧 Kotlin 版本已归档，不参与当前 npm、CI、Docker 或发行包构建。归档保留未提交的代码和本机数据；本机凭据、缓存和依赖不会进入 Git 或镜像。见 [归档说明](archive/kotlin/ARCHIVE.md)。

## Agent 与权限

Agent 管理模型、人格、示例对话、工具和资源。发送者授权只分配普通干员、资深干员或高级资深干员，具体能力由系统固定，子 Agent 不能提升权限。

普通干员可用受限读取命令；资深干员增加文件整理和下载；高级资深干员可使用完整 Shell。前两级只能在 Docker 中执行指定命令及参数。逐次审批仍生效，批准不会提升运行态。

- [固定运行态](docs/fixed-runtime-states.md)与[命令范围](docs/restricted-command-policy.md)
- [上下文与记忆](docs/context-policy-parity.md)、[管理工作台](docs/management-workspace.md)
- [SDK Docker 执行](docs/sdk-docker-execution.md)
- [平台能力](docs/platform-parity.md)、[原生扩展](docs/native-extensions-memory.md)

## 配置与数据

| 环境变量 | 用途 |
|---|---|
| `PRIESTESS_CONFIG` | 首次初始化配置；已有数据库使用已发布配置 |
| `PRIESTESS_DATA_DIR` | 运行数据目录，默认 `.runtime` |
| `PRIESTESS_API_TOKEN` | 管理令牌；未提供则自动生成令牌文件 |
| `HOST` / `PORT` | 默认 `127.0.0.1:8081` |
| `PRIESTESS_DASHBOARD` | Dashboard 静态目录，默认 `dashboard/dist` |
| `PRIESTESS_PUBLIC_BASE_URL` | IM 平台可访问的签名附件地址 |

模型和平台凭据通过环境变量或管理密钥保存，不写入示例配置。发布配置会生成新版本，旧版本可回滚；权限变更会使旧任务授权失效。

## 构建与部署

```sh
docker build -t priestessbot:local .
PRIESTESS_RELEASE_IMAGE=priestessbot:local node --import tsx tools/release-smoke.ts
python3 scripts/prepare-nas-ts-release.py --output /tmp/priestessbot-release.tar.gz
```

`compose.yml` 使用当前根目录构建，默认只发布本机 8081 端口。NAS 原生 Node 部署见 [部署说明](docs/nas-native-deployment.md)。发行包采用文件白名单，不包含归档、凭据或运行数据。

旧 Kotlin 配置通过 `npm run migrate -- --source <旧配置> --target <独立新目录>` 做 dry-run；只有明确的 `--apply` 才写入。外部项目导入工具和源格式说明见 [外部数据迁移](docs/astrbotx-migration.md)。

## 名称与来源

当前产品统一使用 **PriestessBot**。真实上游项目名、源链接、许可证及已持久化的兼容标识不会被伪装成项目自有名称。清单和兼容边界见 [命名审计](docs/project-layout-and-naming.md)；插件来源及许可证见 [第三方署名](docs/plugin-attribution.md)。

当前尚未启用 Codex SDK；Agent 概念和引擎接口保留扩展能力。音频与语音不在当前支持范围。
