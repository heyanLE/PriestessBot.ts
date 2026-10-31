# knowledge-rag — 知识库 / RAG

实现检索增强生成（RAG），让 Agent 能够基于外部知识库回答问题。

## 核心组件

- `KnowledgeBase`：知识库抽象，管理文档集合和检索
- `DocumentLoader`：文档加载器，支持 PDF、Markdown、TXT、HTML、URL 等格式
- `DocumentSplitter`：文档切分策略（按段落、按 Token 数、递归切分等）
- `VectorStore`：向量存储，支持 ChromaDB、Milvus、Qdrant、LanceDB 等后端
- `Retriever`：检索器，基于向量相似度或关键词检索相关文档片段
- `Reranker`：重排序，对检索结果进行二次排序提升相关性

## Agent 集成

`KnowledgeTool` 是一个特殊的 `FunctionTool`，自动注入到 Agent。当用户提问涉及知识库内容时，Agent 自动调用该工具检索相关文档，然后将检索结果融入回答。

## Dashboard 管理

Dashboard 新增 `KnowledgeView` 页面：
- 创建和管理多个知识库
- 文档上传和管理
- 检索测试（输入查询，查看检索结果和排序）
- 查看索引状态和统计信息
