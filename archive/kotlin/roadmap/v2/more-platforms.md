# more-platforms — 更多 IM 平台

扩展 IM 平台适配器，覆盖主流聊天平台。

## 新增平台

- QQ：基于 OneBot 协议或 QQ Official API
- 微信个人：IPC 桥接
- 微信企业：企业微信机器人 API
- 微信公众号：公众号消息推送
- Discord：Discord Bot API
- 钉钉：钉钉机器人 Webhook
- 飞书：飞书机器人
- LINE：LINE Messaging API
- Slack：Slack Bot API

## 统一模式

所有平台实现统一的 `Platform` 接口，支持多实例同类型平台同时运行。优先采用 Webhook 回调模式减少轮询开销。每个平台适配器可作为独立插件发布。
