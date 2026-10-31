# PriestessBot Kotlin 归档

2026-10-30，当前 TypeScript 运行时提升到仓库根目录。本目录保留之前的 Kotlin/JNI 源码、Gradle 工程、部署脚本、Dashboard 快照和历史文档，包含归档前未提交的改动。

这里的代码不参与当前 npm、CI、Docker 或 NAS 发行包构建。需要调查旧行为时从本目录读取；旧项目的运行说明见本目录 README.md。Kotlin Gradle 发行名称已统一为 PriestessBot。

本机原有 config.json、local.properties、平台数据、构建产物和 Gradle 缓存随项目搬入本目录，并由根 .gitignore 排除。不要将这些本机文件作为归档源代码提交、打包或发布。

外部 Codex fork、上游项目与已存储的历史标识保留其真实名称。JNI 编译仍要求原外部 fork；归档不意味着历史工具链已重新构建或适合部署。

当前服务请从仓库根目录的 README.md 启动。不要同时启动归档项目与当前项目的 IM 消费者。
