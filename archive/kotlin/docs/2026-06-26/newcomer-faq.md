# 新人 FAQ

日期：2026-06-26

这份文档收集初次接触仓库时最容易卡住的几个问题，直接给定位路径和处理顺序。

## 为什么先改 `Case`

因为 `Case` 是跨模块的稳定门面，适合做外部入口。先改 `Case`，能减少对 `Controller` 内部实现的直接依赖，也更方便别的模块调用。

看这里：
- `glossary.md`
- `developer-playbook.md`

## 为什么要先看导航图

因为很多需求不是直接对应某个类，而是对应一条链路。先看 `navigation-map.md`，能快速知道从哪个模块、哪个 `Case`、哪个关键文件开始。

看这里：
- `navigation-map.md`
- `repository-tour.md`

## 为什么改动前要先更新文档

因为文档是给后来的开发者用的，也是给自己留的路标。跨模块改动如果不先标出来，后面很容易找不到真正的入口。

看这里：
- `change-recipes.md`
- `feature-delivery-workflow.md`

## 配置刷新去哪看

看 `config`，再看 `workspace`、`provider`，最后回到对应的横切流程页。

顺序：
1. `config.md`
2. `workspace.md`
3. `provider.md`
4. `message-flow.md` 或 `llm-flow.md`

## 链路断了怎么排查

### 消息没回复

1. 看 `message-flow.md`
2. 看 `platform.md`
3. 看 `pipeline.md`
4. 检查 `RespondStage` 和平台 adapter

### 模型没调工具

1. 看 `llm-flow.md`
2. 看 `tool.md`
3. 看 `provider.md`
4. 检查 `ToolPolicy` 和 workspace scope

### skill 没生效

1. 看 `skill.md`
2. 看 `workspace.md`
3. 看 `llm-flow.md`
4. 检查 `ReActRunner.buildSystemPrompt()`

## 一次改动应该先找谁

- 平台事件问题：平台角色
- LLM 和工具问题：推理角色
- 知识、记忆、提醒、persona：增强角色
- 配置、插件、workspace、观测：运行时角色
- 不确定放哪：先找架构角色

## 判断是否可以交付

- 功能行为能跑通。
- 文档能定位到入口。
- 本地验证能通过。
- 交接给另一个角色后，对方能继续推进。

