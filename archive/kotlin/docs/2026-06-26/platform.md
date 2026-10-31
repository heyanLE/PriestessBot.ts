# Platform 模块

日期：2026-06-26

## 代码结构

- `Platform.kt`
- `Platforms.kt`
- `PlatformRegistry.kt`
- `PlatformController.kt`
- `PlatformCase.kt`
- `adapters/telegram/*`
- `adapters/napcat4_18_6/*`
- `adapters/weixin/*`

## 暴露的 Case

- `PlatformCase.handleIncomingMessage(...)`

## 业务职责

Platform 模块负责把不同 IM 平台的事件统一成 `MessageEvent`，再把消息送入 pipeline，反向也负责发送回复。

## 结构图

```mermaid
flowchart TD
    A[PlatformCase] --> B[PlatformController]
    B --> C[PlatformRegistry]
    C --> D[Telegram/NapCat/Weixin Adapter]
    A --> E[PipelineCase]
```

## 流程图

```mermaid
flowchart TD
    A[平台原生事件] --> B[适配器解析]
    B --> C[MessageEvent]
    C --> D[PlatformCase.handleIncomingMessage]
    D --> E[PipelineCase.process]
```

## 微信 iLink

内置 `weixin` adapter 通过腾讯 iLink Bot API 长轮询接入个人微信 Bot 身份，首版提供文本收发、同步游标与会话 context token 持久化、Unicode 安全分块、重试/限流保护和优雅停止。配置方法与平台限制见 [微信 iLink Platform](../2026-07-22/weixin-platform.md)。
