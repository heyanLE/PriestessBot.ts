# 模块协作矩阵

日期：2026-06-26

这份文档从模块之间的协作角度看系统，回答“谁给谁供数据、谁依赖谁、谁是入口”。

## 核心矩阵

| 模块 | 输入来自 | 输出给 | 关键关系 |
| --- | --- | --- | --- |
| `platform` | 外部 IM 平台 | `pipeline` | 把原始事件变成统一 `MessageEvent` |
| `pipeline` | `platform`、`config`、`workspace` | `agent`、`conversation`、`platform` | 组织消息处理阶段链 |
| `conversation` | `pipeline`、`agent` | `agent`、`server` | 存会话和消息历史 |
| `persona` | `workspace`、`server` | `pipeline`、`agent` | 提供 persona 注入 |
| `workspace` | `config`、`tool`、`skill`、`persona` | `pipeline`、`agent`、`tool` | 决定作用域和可用资源 |
| `agent` | `pipeline`、`provider`、`tool`、`skill` | `provider`、`tool` | 负责推理循环 |
| `provider` | `agent`、`config` | `agent`、`server` | 提供模型接入和健康检查 |
| `tool` | `agent`、`workspace` | `agent`、`workspace` | 执行函数工具和 MCP 工具 |
| `skill` | `workspace`、`pipeline` | `agent`、`pipeline` | 注入 prompt 文档和轻量派发 |
| `knowledge` | `tool`、`server` | `agent`、`dashboard` | 提供检索能力 |
| `memory` | `tool`、`persona`、`agent` | `agent`、`server` | 提供长期记忆 |
| `reminder` | `tool`、`server` | `platform`、`agent` | 提供提醒投递 |
| `plugin` | `config`、`runtime` | `platform`、`provider`、`tool` | 提供扩展能力 |
| `observability` | `pipeline`、`agent`、`tool`、`server` | `dashboard` | 提供指标和健康信息 |
| `server` | `config`、`provider`、`conversation` | 人和工具 | 暴露 Dashboard API |

## 入口优先级

1. 外部平台入口：`platform`
2. 消息处理入口：`pipeline`
3. 推理执行入口：`agent`
4. 工具入口：`tool`
5. 配置和作用域入口：`config`、`workspace`
6. 观测入口：`server`、`observability`

## 常见链路

### 消息链路

`platform` -> `pipeline` -> `conversation` / `workspace` / `persona` -> `agent` -> `provider` / `tool` -> `platform`

### 作用域链路

`config` -> `workspace` -> `skill` / `tool` / `persona` -> `agent`

### 观测链路

`pipeline` / `agent` / `tool` -> `observability` -> `server`

## 看这张表的方式

- 先找自己要改的模块。
- 再看它的上游输入和下游输出。
- 如果跨了三层以上，优先回到 `feature-delivery-workflow.md`。

