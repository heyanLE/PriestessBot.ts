# PriestessBot Dashboard

当前前端位于 `dashboard/`，使用 Vue 3、Vite 和强类型 TypeScript。共享运行契约来自根目录 `packages/contracts/`。

在仓库根目录运行 `npm run dev` 启动后端，再运行 `npm run dev:dashboard` 启动前端。Vite 的 `/api/ts` 和 `/health` 默认代理到 `127.0.0.1:8081`，可通过 `VITE_TS_PORT` 更改端口。

`npm run build` 同时构建后端和前端；也可分别使用 `npm run build:server`、`npm run build:dashboard`。Node 服务默认提供 `dashboard/dist`，发行镜像通过 `PRIESTESS_DASHBOARD` 指定静态目录。

`npm run test:dashboard` 运行工作流逻辑测试；生产构建包含 TypeScript 严格扫描和 Vue 类型检查。旧 Kotlin/Rust 页面及旧接口保留在 `archive/kotlin/dashboard/`，不参与当前构建。
