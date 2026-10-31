# more-providers — 更多 Provider

扩展 LLM 及相关服务 Provider，覆盖更多模型和模态。

## 新增 ChatProvider

- Anthropic Claude：支持 Tool Use，支持流式
- Gemini：Google Gemini API，支持多模态输入
- DeepSeek：DeepSeek API（兼容 OpenAI 格式）
- Qwen：通义千问 API
- Moonshot：月之暗面 Kimi
- Groq：高速推理 API
- OpenRouter：统一 LLM 路由平台

## 新增非 Chat Provider

- STT：Whisper API、Azure STT、本地 Whisper，语音转文字
- TTS：OpenAI TTS、Edge TTS、ElevenLabs、FishAudio，文字转语音
- Embedding：OpenAI Embedding、Ollama Embedding、Jina、Cohere Embed
- Rerank：Cohere Rerank、Jina Rerank、BGE Reranker

## ProviderManager 增强

支持按类型（Chat/STT/TTS/Embedding/Rerank）分组管理，支持负载均衡和多 Provider 自动切换（按可用性或成本）。
