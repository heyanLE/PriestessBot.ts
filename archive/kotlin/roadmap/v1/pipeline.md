# pipeline — 消息管道

实现消息从 IM 端收到到最终回答的完整处理流程，采用洋葱模型调度。

## 洋葱模型

每个 Stage 的 `process()` 方法可选返回 `Flow<Unit>`。返回 Flow 表示该 Stage 需要前置处理后暂停、执行后续所有阶段、再回来执行后置处理（类似 Koa/Redux 中间件）。返回 null 表示纯线性执行。

## 九个阶段

按执行顺序：

1. **WakingCheckStage** — 唤醒检查，判断消息是否触发机器人（群聊 @提及、前缀匹配等），不满足则停止处理
2. **WhitelistCheckStage** — 白名单过滤，仅白名单内的用户或群组可触发
3. **SessionStatusStage** — 会话状态检查，会话被禁用则跳过
4. **RateLimitStage** — 频率限制，基于用户或会话的调用频次控制
5. **ContentSafetyStage** — 内容安全审核，过滤敏感输入
6. **PreProcessStage** — 前置装饰，注入 System Prompt、加载历史上下文、拼接 Skill 指令
7. **ProcessStage** — 核心阶段，调用 AgentRunner 执行 ReAct 循环
8. **ResultDecorateStage** — 回答装饰，格式化输出（预留 TTS、Markdown 渲染等）
9. **RespondStage** — 发送回答，将最终消息通过 Platform 发送给用户

## 调度器

`PipelineScheduler` 接收 `MessageEvent`，按 Stage 顺序依次执行。任何阶段可通过设置 `event.isStopped = true` 终止后续处理。支持 `PipelineContext` 跨阶段传递上下文数据。
