# provider — LLM Provider 抽象层

定义统一的 LLM Provider 接口，支持接入不同的 LLM 服务。

## 多态接口

一期只实现 `ChatProvider`，预留 STT / TTS / Embedding / Rerank 接口：

- `ChatProvider`：文本对话，只实现同步调用 `textChat()`，返回完整 `LLMResponse`。流式调用 `textChatStream()` 接口预留，二期实现
- 预留接口：`STTProvider`（语音转文字）、`TTSProvider`（文字转语音）、`EmbeddingProvider`（向量嵌入）、`RerankProvider`（重排序）

## ProviderManager

管理多个 Provider 实例，支持按名称切换、连通性测试、模型列表拉取。

## 请求/响应模型

统一 DTO 定义：
- `LLMRequest`：包含消息列表、工具定义、System Prompt、模型名称、温度等参数
- `LLMResponse`：包含文本内容、Tool Call 列表、Token 用量、Finish Reason
- `ConversationMessage`：角色（system / user / assistant / tool）、内容、Tool Call 信息

## 内置适配器

- `OpenAIProvider`：对接 OpenAI API 及兼容服务（兼容 DeepSeek、Qwen 等），支持 Function Calling，一期只做同步调用
- `OllamaProvider`：对接本地 Ollama，支持 Chat API 和模型列表查询，一期只做同步调用
