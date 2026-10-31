# Memory 模块

日期：2026-06-26

## 代码结构

- `MemoryModels.kt`
- `MemoryController.kt`
- `MemoryCase.kt`

## 暴露的 Case

- `MemoryCase.save(...)`
- `MemoryCase.list(...)`
- `MemoryCase.search(...)`
- `MemoryCase.delete(...)`
- `MemoryCase.expire(...)`

## 业务职责

Memory 模块负责长短期记忆的保存、检索、删除和过期清理，服务于 persona 和 agent 上下文增强。

## 结构图

```mermaid
flowchart TD
    A[MemoryCase] --> B[MemoryController]
    B --> C[MemoryRecord]
    B --> D[MemorySearchResult]
```

## 流程图

```mermaid
flowchart TD
    A[写入 memory] --> B[按 scope 保存]
    C[读取 memory] --> D[按 filter/search 查询]
    E[过期任务] --> F[清理超期记录]
```

