# 三平台与 AstrBotX 对照

本轮范围固定为 **NapCat、Telegram、微信 iLink**。平台工厂只注册这三个已实现协议的类型。参考 AstrBotX 本地源码 `astrbot/core/platform/sources/{aiocqhttp,telegram,weixin_oc}`；消息格式参考 `astr_main_agent.py` 的 message_meta 及 `agent/runners/codex/codex_agent_runner.py` 的 group_history、quoted context、speaker_change。没有移植 Python 插件或声称所有 AstrBotX 平台已兼容。

## 已实现的传输与消息

| 能力 | Telegram | NapCat / OneBot v11 | 微信 iLink |
|---|---|---|---|
| 入站 | Bot API getUpdates 长轮询，offset 持久化 | 正向 WebSocket，验证协议帧，断线重连 | getupdates 长轮询，cursor 与每用户 context_token 持久化 |
| 登录/鉴权 | token 环境变量、getMe | Bearer access token；可选 HTTP API | token 环境变量/持久状态；扫码 beginLogin、pollLogin |
| 身份 | 私聊/群 sender 与 chat 分离；匿名群身份使用独立 ID | 私聊/群 user_id 与 group_id 分离 | 私聊 from_user_id 独立身份；首版不支持群 |
| 文本/引用 | text/caption、mention、reply 原作者/文本 | 消息数组及 CQ 字符串、at、get_msg 引用上下文 | text_item、ref_msg |
| 图片入站 | getFile 鉴权下载；不把 token URL交给模型 | image URL 或 get_image；受限 HTTPS 下载 | CDN 下载，AES-128-ECB 解密，支持两种 key 编码 |
| 文件入站 | document/getFile | file 消息与 group_upload notice、get_group_file_url | file_item/CDN 解密 |
| 文本发送 | sendMessage；MarkdownV2 转义与分页 | send_private_msg/send_group_msg；可读文本分页 | sendmessage、context_token、稳定 client_id；纯文本降级 |
| 图片发送 | sendPhoto，artifact multipart/URL/平台 file ID | 原生 image base64 段 | getuploadurl → AES 加密 → CDN 上传 → image_item |
| 文件发送 | sendDocument，artifact multipart/URL/平台 file ID | upload_private_file/upload_group_file；artifact 通过宿主单文件短时签名 URL | 同一 CDN 加密链路 → file_item，保留文件名与大小 |
| 流式 | 按节流间隔编辑；超长最终分页；明确编辑拒绝时最终文本回退 | 无编辑能力；按配置分段或最终发送 | 无编辑能力；按配置分段或最终发送 |
| 发送可靠性 | 三平台共用持久 delivery ID + 分段 effect 状态；已确认不重发，发送结果不确定时禁止自动重放 |||
| 停止 | abort 长轮询 | 关闭 WebSocket、终止 pending API | abort 长轮询；无 token 时可等待扫码 |

NapCat 的文件协议端可能运行在别的主机/容器，因此不把应用宿主文件路径传给 NapCat。签名 URL 必须只授权一个 artifact、具有短期有效期，并配置为 NapCat 可访问的应用地址；未配置 resolver 时明确报错。平台适配器不记录签名 URL。宿主负责鉴权、签名验证和过期检查。

## 信息处理层

- `MessageContextBuilder` 输出结构化 Principal 与独立消息正文；message_meta 标注平台、会话、发送者、时间和消息 ID，显示名明确视为不可信文本。
- group_history 只接收公共入站群消息，按条数、字符数和群数限制；预留历史在模型接收后提交，失败时归还；拒绝触发消息从待用历史删除。
- 引用和群历史文本转义，标注仅供参考；speaker_change 提醒本轮发送者改变。文本标签不能更改真实 Principal 或授权。
- `MediaPipeline` 在模型前鉴权下载并检查大小。图片按文件头验证支持 JPEG/PNG/GIF/WebP；文件只处理 UTF-8 文本/Markdown/JSON 等文本及 PDF，PDF保留页码并限制页数与提取字数。
- 模型收到图片 data URI 和已提取文件文本，不把 IM 凭据、远程 URL 或本机路径直接当作可读附件。

## 明确不在首版中的能力

- 音频识别、语音合成、视频理解、实时语音；入站音频返回明确占位说明。
- Telegram webhook、论坛 topic 专门会话策略、频道广播、媒体组聚合、复杂实体保真渲染。
- NapCat 反向 WebSocket 服务端、合并转发节点完整解析、所有 NapCat 扩展管理动作。现有 groupMembers 方法需要由宿主工具注册和授权后使用。
- 微信公众平台、企微、第三方非 iLink 微信协议；微信 iLink 群聊、typing 状态、撤回、编辑、完整历史引用回溯。
- 自定义 Python 平台插件兼容、AstrBotX 其他 IM 自动支持。

## 验证证据与边界

测试文件：

- `tests/platform-protocol.test.ts`：三平台 JSON fixtures、offset/停止、发送幂等与不确定结果、微信 QR/context、CDN AES 上传下载、Telegram multipart、NapCat CQ/群文件/签名 URL。
- `tests/platform-websocket.test.ts`：真实 localhost WebSocket 服务器验证 NapCat连接、收消息、echo API关联、发送与停止。
- `tests/message-processing.test.ts`：消息元数据/引用边界、群历史预留/恢复、Unicode分页、流式编辑与明确拒绝/不确定结果分支。
- `tests/platform-media.test.ts`：真实 PDF解析、UTF-8/二进制校验、媒体大小限制及图片模型输入物化。

以上为协议和本机传输验证，不等同于三种真实账号端到端验收。本轮没有启动实际账号消费者，也没有向真实联系人发送测试消息。接入真实账号仍需要有效 token/扫码登录、单消费者切换以及平台实例到已授权 Agent 的路由配置。

其他 AstrBotX 适配器只作为未来候选：Discord、Slack、飞书、钉钉、企微、微信公众平台、QQ 官方机器人等；逐个补真实协议、能力声明和集成测试后才能注册支持。

### 2026-10-25 真实 Telegram 会话检查

已按 `telegram-web-smoke` 技能和 runbook，通过 Computer Use 打开独立 `Telegram Web` 应用。当前页面为 `Log in to Telegram by QR Code`，不存在已登录聊天会话。未进行扫码登录、未切换其他账号，也未发送真实消息。因此本轮 Telegram 用户端端到端验收仍需要用户先完成手机登录；协议 fixture、localhost WebSocket、媒体及停止竞态测试已独立完成，不能用这些测试替代真实账号验收。

后续审查补强包括：停机期间引用/微信 context 持久化不会提交迟到消息；未接收事件不推进 cursor；错误媒体与非法消息不会永久堵塞后续更新；微信 `errcode=-14` 会清理旧 token/account/cursor/context；切换微信账号不会复用旧回复令牌；出站流式每页重新检查当前执行授权；公网媒体下载固定已验证 DNS 地址，并拒绝私网及 IPv4-mapped IPv6。
