# PriestessBot Dashboard

PriestessBot 的 Vue 管理界面。当前页面只连接根目录 Node.js 服务的 `/api/ts` 接口。Kotlin 与 Rust 的旧页面已归档，不再进入活跃前端构建。

## 本机运行

需要 Node.js 22.18 或更新版本。先在仓库根目录安装依赖并启动服务：

```sh
npm ci
npm --prefix dashboard ci
npm run dev
```

在另一个终端、同一仓库根目录启动 Dashboard：

```sh
npm run dev:dashboard
```

Vite 默认使用 `5173` 端口，将 `/api/ts`、`/api`、`/health` 和 `/ws` 转发到 `127.0.0.1:8081`。设置 `VITE_TS_PORT` 可以更改后端端口；此变量继续兼容已有启动命令。管理登录使用服务端令牌和 HttpOnly 会话 Cookie，活跃界面不将令牌写入浏览器本地存储。

## 页面与操作

主入口为工作台、Agent、机器人、资源库、设置。Agent 和人格绑定可以一起发布，其他对象的未完成草稿保留。人格库只编辑人格；分配人格在 Agent 中完成。发送者授权支持多个 ID 共用一个固定运行态。

会话页按时间平铺全部平台记录，默认包含归档记录。可按平台实例、群聊或私聊、会话 ID、Agent 和关键词筛选。控制台对话 `/chat` 只显示控制台历史；平台会话在 `/sessions` 查看。

记录分为 `/route-records` 路由记录和 `/agent-records` Agent 记录。前者解释接入、忽略、指令与分派结果；后者显示模型与工具调用、用量、审批和产物。两页可互相跳转，并导出有长度上限且已脱敏的审计 JSON。旧 `/runs` 书签保留跳转。旧数据缺少指标时显示“未知”，不会补成零。

右侧草稿测试调用模型，但不执行工具或发送 IM。命令工具的实际范围由固定运行态、工具装配和执行环境共同决定。普通与资深干员使用受限命令；高级资深干员才可使用完整 Shell。

## 检查

在仓库根目录运行：

```sh
npm run build:dashboard
npm run test:dashboard
```

前端构建执行严格 TypeScript 检查和 Vue 类型检查。流程测试使用根目录的 `packages/contracts` 与 `node_modules/tsx`，不连接真实机器人。

两份浏览器测试脚本保留为独立入口，须显式准备 Playwright 与兼容浏览器：

```sh
npm --prefix dashboard run test:typescript
npm --prefix dashboard run test:typescript-live
```

- `test:typescript` 使用内存 API 夹具，不访问真实模型或 IM。
- `test:typescript-live` 只用于专用临时服务。设置 `TS_TEST_TOKEN`，并按需设置 `TS_TEST_BASE`；默认地址为 `http://127.0.0.1:8081`。测试会创建临时资源并发布配置，不能指向生产 NAS。
- `PLAYWRIGHT_MODULE` 可指定已有 Playwright 模块路径，`TEST_BROWSER_EXECUTABLE` 可指定浏览器程序。

测试截图写入 `dashboard/.build/ts-ui/`。运行浏览器测试仍需遵守当前会话的浏览器授权与安全限制。

## 旧界面归档

完整历史 Dashboard 快照保存在 [`archive/kotlin/dashboard`](../archive/kotlin/dashboard/)。移出活跃目录的文件清单见 [`archive-removal-manifest.json`](archive-removal-manifest.json)；移除前已逐文件校验 SHA-256。

旧 `/legacy/...` 书签跳转到对应的当前页面，`/rust` 跳转到消息路由。它们不会加载归档代码或访问旧服务。当前视觉与操作约定见 [`DESIGN.md`](DESIGN.md)。
