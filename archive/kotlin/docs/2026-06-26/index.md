# PriestessBot 架构文档索引

日期：2026-06-26

这一组文档按 `com.heyanle.priestess.bot` 的子包拆分，外加两份横切流程文档。

## 模块文档

- [agent.md](./agent.md)
- [config.md](./config.md)
- [conversation.md](./conversation.md)
- [core.md](./core.md)
- [knowledge.md](./knowledge.md)
- [memory.md](./memory.md)
- [observability.md](./observability.md)
- [persona.md](./persona.md)
- [pipeline.md](./pipeline.md)
- [platform.md](./platform.md)
- [plugin.md](./plugin.md)
- [provider.md](./provider.md)
- [reminder.md](./reminder.md)
- [server.md](./server.md)
- [skill.md](./skill.md)
- [tool.md](./tool.md)
- [workspace.md](./workspace.md)

## 横切流程

- [getting-started-architecture.md](./getting-started-architecture.md)
- [developer-playbook.md](./developer-playbook.md)
- [navigation-map.md](./navigation-map.md)
- [repository-tour.md](./repository-tour.md)
- [glossary.md](./glossary.md)
- [change-recipes.md](./change-recipes.md)
- [local-dev-and-verification.md](./local-dev-and-verification.md)
- [feature-delivery-workflow.md](./feature-delivery-workflow.md)
- [newcomer-faq.md](./newcomer-faq.md)
- [role-reading-paths.md](./role-reading-paths.md)
- [docs-maintenance-guide.md](./docs-maintenance-guide.md)
- [module-collaboration-matrix.md](./module-collaboration-matrix.md)
- [scenario-walkthroughs.md](./scenario-walkthroughs.md)
- [multi-role-collaboration.md](./multi-role-collaboration.md)
- [message-flow.md](./message-flow.md)
- [llm-flow.md](./llm-flow.md)

## 视角

- 模块页关注代码结构、`Case` 门面、业务职责、结构图和局部流程。
- 导读页关注新人如何快速建立全局认知。
- 手册页关注新人如何开始改代码。
- 导航页关注“我要改什么”时该看哪里。
- 导览页关注仓库目录长什么样。
- 术语页关注概念和代码位置的对照。
- 速查页关注常见需求怎么落到代码。
- 本地开发页关注怎么跑起来和怎么验改动。
- 交付流程页关注一个功能怎么从想法走到交付。
- FAQ 页关注新手最容易卡住的问题。
- 角色阅读页关注不同岗位各自的起步路线。
- 维护页关注以后怎么持续更新这套文档。
- 协作矩阵页关注模块之间怎么互相供数和依赖。
- 场景走读页关注拿着一个需求时应该怎样一路读下去。
- 协作页关注如何按角色分工推进实现。
- 横切页关注从平台消息进入系统到回复，以及从 Agent 到 LLM / context / tools / skill / MCP 的完整链路。
