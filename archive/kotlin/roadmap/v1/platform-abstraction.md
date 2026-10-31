# platform-abstraction — IM 平台抽象层

定义统一的 IM 平台接口，使得接入 QQ、微信、Telegram 等不同平台时，上层逻辑无需感知差异。

## 核心抽象

`Platform` 为抽象基类，定义以下能力：
- `run()`：启动平台监听，返回协程 Job
- `sendMessage()`：向指定会话发送消息
- `terminate()`：优雅关闭平台连接
- `commitEvent()`：将收到的消息转换为统一的 `MessageEvent` 推入事件总线

`PlatformManager` 管理多个平台实例的启停和生命周期。`PlatformRegistry` 通过注解收集所有已注册的 Platform 实现。

## 统一消息模型

- `MessageEvent`：统一消息事件体，包含来源平台、会话信息、消息链、时间戳
- `MessageSession`：会话抽象，包含会话 ID、类型（私聊/群聊/频道）、来源平台
- `MessageChain`：消息链，由多个 `MessageComponent` 组成
- `MessageComponent`：sealed class，支持 Text / Image / At / File 等消息组件

## 内置适配器

一期内置两个 Platform 实现：

- `TelegramPlatform`：基于 Telegram Bot API，支持长轮询和 Webhook 两种模式，支持文本、图片、文件收发
- `NapCatPlatform`：基于 NapCat HTTP API 接入 QQ，配置 IP + 端口即可对接，无需自行启动 NapCat 进程，支持文本、图片等消息收发
