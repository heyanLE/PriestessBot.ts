# Core 模块

日期：2026-06-26

## 代码结构

- `controller/BaseController.kt`
- `db/Database.kt`
- `db/DatabaseController.kt`
- `db/DatabaseCase.kt`
- `di/CoreModule.kt`

## 暴露的 Case

- `DatabaseCase.execute(...)`

## 业务职责

Core 模块提供运行时基础设施：控制器生命周期、数据库执行门面和 DI 组装。

## 结构图

```mermaid
flowchart TD
    A[CoreModule] --> B[BaseController]
    A --> C[DatabaseController]
    C --> D[DatabaseCase]
```

## 流程图

```mermaid
flowchart TD
    A[Runtime 启动] --> B[初始化 DI]
    B --> C[打开数据库]
    C --> D[业务模块通过 DatabaseCase 执行]
    D --> E[Runtime 关闭时统一停止]
```

