# NapCat 开始处理表情

参考 [AstrBotX a0ad1eaa 的 QQ 预回应实现](https://github.com/xkeyC/AstrBotX/blob/a0ad1eaa0dd10c52f3771977fa33d396d0158c47/astrbot/core/platform/sources/aiocqhttp/aiocqhttp_message_event.py#L66)，该提交在 2026-10-28 核验为远端最新。

在 Dashboard「机器人」中选择 NapCat 实例，在「开始处理表情」中开启功能并填写表情列表。保存配置后生效。机器人实际开始处理群聊请求时，会给触发该请求的消息贴一个表情，提示消息已开始处理。

## 配置

```json
{
  "preAckEmoji": {
    "enabled": true,
    "emojis": ["124", "👀", "🤔"]
  }
}
```

- `preAckEmoji.enabled` 默认为 `false`，用于控制当前 NapCat 实例是否开启功能。
- `preAckEmoji.emojis` 默认为 `["124"]`，最多 32 项。多项时随机选一个；空列表不贴表情，即使开关已开启。
- 每项支持 QQ 表情数字 ID 或单个 Unicode 表情。`124` 是 OK，`76` 是赞，`66` 是爱心；Unicode 示例为 `👀`、`🤔`、`❤️`。不支持 ZWJ 连缀、肤色组合或旗帜等复杂组合表情。是否能显示还取决于 NapCat 和 QQ 对该表情的支持。
- Dashboard 每行填写一项，保存时转换为字符串数组。数字 ID 也以字符串保存。

## 触发与投递

仅对已通过消息筛选、路由与授权，并实际进入处理的群聊请求贴表情。被路由忽略的普通群消息、未通过授权的请求、仍在队列等待的请求和私聊不会触发。表情贴在触发消息上，不是其引用的原消息；处理完成后不撤回表情。

对齐 AstrBotX 的 NapCat 协议，使用 OneBot `set_msg_emoji_like`，传入触发消息的 `message_id`、所选 `emoji_id` 和 `set: true`。这是平台处理提示，不是 Agent 可调用的工具，不增加 Agent 或发送者的权限。

贴表情与模型处理并行，单次请求最多等待 5 秒。请求失败或超时不重试、不影响正常回复，也不额外发送提示消息。

自动化验证覆盖配置和请求行为，不代表已通过真实 QQ 客户端的显示验收。部署时如为现有实例启用 `124`，以实际保存的配置为准；其他实例不会因默认值而自动开启。
