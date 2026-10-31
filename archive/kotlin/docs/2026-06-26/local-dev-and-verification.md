# 本地开发与验证

日期：2026-06-26

这份文档把“看懂架构”落到“本地怎么跑、怎么验改动”。

## 启动入口

- 主程序入口：`com.heyanle.priestess.bot.PriestessBotKt`
- Gradle 应用配置：`build.gradle.kts`
- Dashboard 前端目录：`dashboard/`

## 本地开发流程

1. 先读 [getting-started-architecture.md](./getting-started-architecture.md)。
2. 再看 [developer-playbook.md](./developer-playbook.md) 和 [navigation-map.md](./navigation-map.md)。
3. 认领对应模块，优先通过 `Case` 改动。
4. 改完后补对应模块页或横切流程页。
5. 最后做本地验证。

## 常用验证命令

```bash
./gradlew test
```

```bash
./gradlew run
```

```bash
./gradlew -PbuildDashboard=true build
```

## 验证内容

### 后端

- 单元测试是否通过。
- 相关模块的 `Case` 是否还能正常工作。
- 横切链路是否仍然能从平台进入 pipeline，再到 Agent 和回复。

### 前端

- Dashboard 是否能正常构建。
- 需要的静态资源是否被打包进资源目录。

### 文档

- 模块页是否仍然覆盖代码结构和 `Case`。
- 新增行为是否更新了横切流程页。
- 常见改动是否仍然能在导航图里找到入口。

## 常见检查点

| 想确认的事 | 先看哪里 |
| --- | --- |
| 消息能不能进系统 | `message-flow.md`、`platform`、`pipeline` |
| 模型为什么没工具调用 | `llm-flow.md`、`tool`、`provider` |
| workspace 是否生效 | `workspace`、`config` |
| skill 是否注入 | `skill`、`workspace`、`llm-flow.md` |
| 配置是否刷新 | `config`、`provider`、`workspace` |

## 推荐习惯

- 每次改动先定位一个 `Case`。
- 改动跨模块时，先更新文档再写实现。
- 合并前至少跑一次 `./gradlew test`。
- 涉及 Dashboard 时，再跑一次前端构建。

