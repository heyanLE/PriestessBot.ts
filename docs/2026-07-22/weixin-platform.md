# 微信 iLink Platform

日期：2026-07-22

## 适用范围

`weixin` 是个人微信 Bot 的内置 platform adapter，协议参考腾讯 iLink Bot API。它不是微信网页自动化，也不是企业微信、公众号或群机器人 webhook。

当前稳定范围：

- iLink 长轮询接收文本；
- Dashboard 生成二维码、跟踪扫码/手机确认并自动保存登录凭据；
- 私聊文本回复；
- 识别带 room ID 的群消息并保留真实发送者（实际群投递能力由 iLink 账号决定）；
- 跨重启保存 `get_updates_buf` 和每个会话的 `context_token`；
- 2000 Unicode code point 以内分块、串行发送、有界重试和频控冷却；
- platform 禁用、配置变更和进程退出时取消轮询并关闭 HTTP client。

当前不包含图片/文件 AES CDN、语音、typing indicator、消息编辑和流式更新。普通微信群通常不能邀请 iLink Bot 身份，因此不要把群聊可用性作为部署前提。

## 如何扫码登录

扫码属于管理写操作，必须先给 Dashboard API 配置鉴权。设置一个足够随机的环境变量，例如：

```bash
export PRIESTESS_DASHBOARD_TOKEN='replace-with-a-long-random-value'
```

在 Configuration v2 的 `runtime.server` 中引用它，并添加一个无需手工 token/account ID 的微信 platform：

```json
{
  "runtime": {
    "server": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": 8080,
      "apiCredentialRef": {
        "source": "ENVIRONMENT",
        "key": "PRIESTESS_DASHBOARD_TOKEN"
      }
    }
  },
  "platforms": [
    {
      "id": "weixin-main",
      "type": "weixin",
      "enabled": true,
      "settings": {
        "stateDirectory": "data/weixin-main"
      }
    }
  ]
}
```

保留你配置中其他 `runtime`、provider 和 Workspace 字段，不要用上述片段整份覆盖。应用启动后：

1. 打开 `http://127.0.0.1:8080/?token=replace-with-a-long-random-value`，再进入 Dashboard 的 `Platforms` 页面（token 会保存在浏览器本地存储）；
2. 找到 `weixin-main`，点击“微信扫码连接”；
3. 用微信扫描弹窗中的二维码；
4. 在手机微信中确认登录；
5. 页面显示“登录成功，平台已启动”后即可向 Bot 发私聊消息。

二维码内容在服务端用 ZXing 本地渲染，不会发给第三方图片服务。二维码最多自动刷新三次，整个登录会话最多八分钟；关闭弹窗会取消登录。

扫码确认后，iLink 返回的 `bot_token`、account ID 和 API origin 会原子写入 `stateDirectory/credentials.json`。token 不会返回浏览器、写入版本化 `config.json` 或进入配置备份。POSIX 系统会尽量把凭据文件权限设为 `0600`。

如果已有环境 token，仍可使用 `credentialRefs.token` 和 `settings.accountId`；显式配置优先于扫码保存的凭据。使用显式 token 的实例不能同时发起 QR 登录，如需改为扫码管理，先删除该 platform 的 `credentialRefs.token`。不要提交 token 或 `credentials.json` 到 Git，并确保同一 iLink 账号只有一个启用的 PriestessBot platform 实例。

## 可选参数

数值参数均写在 Connection 的 `settings` 字符串 map 中：

```json
{
  "stateDirectory": "data/weixin-main",
  "pollTimeoutMillis": "35000",
  "pollRetryDelayMillis": "2000",
  "pollMaxBackoffMillis": "30000",
  "sendRetries": "3",
  "sendRetryDelayMillis": "1000",
  "sendChunkDelayMillis": "1500",
  "rateLimitCooldownMillis": "30000",
  "maxMessageCodePoints": "2000",
  "deduplicationTtlMillis": "300000",
  "deduplicationMaxEntries": "10000"
}
```

`baseUrl` 也位于 `settings`。QR 登录返回的 origin 仅允许受信任的 `*.weixin.qq.com` HTTPS 主机；非法值会拒绝登录，避免服务端请求伪造。

`supportProactiveMessage` 当前为 `false`。普通回复仍通过原始消息的 session 发送，但主动消息工具不会向未经真实 iLink 验证的无上下文会话推送。

## 状态与投递语义

状态默认位于 `.priestess/weixin/<platform-name>`，也可用 `stateDirectory` 指定。目录包含：

- `state.json`：最近成功提交批次的 `get_updates_buf` 和按目标会话保存的 `context_token`；
- `credentials.json`：扫码确认后的 iLink credential，仅供微信 adapter 读取。

两者都采用同目录临时文件加原子替换（文件系统不支持时安全降级为 replace），POSIX 系统会尽量设置为 `0600`。Dashboard 和配置查询接口不会返回凭据内容。

游标只在整批可处理消息成功交给 pipeline 后推进。如果 pipeline 抛错，游标保持不变并允许重试；这提供“至少一次”语义，进程在提交与落盘之间崩溃时仍可能重放，不能宣称 exactly-once。运行时仅按成功处理的 `message_id` 做有界 TTL 去重，不按文本内容去重，因此用户连续发送相同文字不会被误删。

Docker/NAS 部署必须把 `stateDirectory` 放在持久卷中，否则重建容器会丢失游标和上下文。

## 错误恢复

- 长轮询超时视为空批次；网络、HTTP 5xx 和无效 JSON 使用有上限的退避并从旧游标重试。
- 单个回复 chunk 的可重试传输错误最多重试 `sendRetries` 次，所有尝试复用同一 `client_id`，降低服务端重复发送概率。
- `-14`，以及 `-2 + unknown error`，按过期上下文处理：删除该会话 token，并只进行一次无 token 降级尝试。
- 其他 `-2` 按真实频率限制处理，立即打开本地冷却；冷却期间不会继续调用 iLink。
- 轮询返回会话过期时停止该 platform job，并提示刷新凭据，避免无休止撞击失效会话。

日志只记录 endpoint、HTTP 状态和业务错误码，不记录 bearer token、context token 或服务端原始响应正文。

## 验证建议

自动化测试不需要网络或微信账号：

```bash
./gradlew test --tests 'com.heyanle.priestess.bot.platform.adapters.weixin.*'
```

真实联调应使用专用测试账号，至少检查：

1. Dashboard 能生成二维码，扫码确认后不需要手工复制 token；
2. 首次长轮询能收到私聊文本；
3. 回复到达同一 peer；
4. 重启后从旧 cursor 继续且回复仍可使用已保存上下文；
5. 重新扫码后只保留一个 poller；
6. 断网恢复、会话过期和限流期间没有请求风暴；
7. 禁用 platform 后没有残留长轮询或 HTTP 连接。

外部 iLink 服务的账号资格、可用性、错误码含义和协议兼容性不由 PriestessBot 控制，升级前应使用专用账号做一次 opt-in smoke test。
