# Dashboard UX Package Index

整理时间：2026-07-08

## 交付说明

本目录收录 `PriestessBot` 新 dash UX 阶段的完整交付物。

本阶段目标是：

- 参考 `hermes-agent` 的 dashboard UX
- 重新定义 `PriestessBot` 新 dash 的信息架构与关键交互
- 产出可直接进入下一阶段 UI 设计的 UX 包

## 交付物

### 1. 主 UX 交互稿

[dashboard-ux-interaction-draft.md](dashboard-ux-interaction-draft.md)

内容包括：

- 产品定位
- 目标用户
- UX 原则
- 核心对象模型
- 一级信息架构
- 首页工作台结构
- 关键主路径
- 状态体系
- 旧页面迁移原则

### 2. 低保真线框稿

[dashboard-ux-wireframes.md](dashboard-ux-wireframes.md)

内容包括：

- 全局壳层
- 5 个核心页面线框
- 资产页通用模板
- 响应式约束
- 页面跳转规则

### 3. Live 验证记录

[dashboard-ux-live-validation.md](dashboard-ux-live-validation.md)

内容包括：

- `hermes-agent` dashboard 的实际启动方式
- live 服务确认
- 默认落点、导航长度、空态、Config/System 页观察
- 对新 dash 的回写结论

## 本次方法

本次采用多角色推进：

- `参考分析`：拆解 `hermes-agent` 的 dashboard 路由、页面主路径和交互重点
- `工程约束`：梳理 `PriestessBot` 现有 dashboard 的数据域、强约束和迁移边界
- `产品任务流`：从运维者视角反推新 dash 的信息架构和主任务闭环

主线程负责整合三条结论，并把其落为：

- 主稿
- 线框
- live 验证

## 阶段结论

新 dash 不应继续沿用旧 dashboard 的“功能页集合”结构，而应收敛为：

- 总览
- 排障
- 变更
- 资产

并把首页明确设计为：

- 运行态优先的 agent 运维工作台

而不是：

- 会话后台首页
- 纯配置后台首页
- 系统总后台首页

## 下一阶段输入

下一轮 UI 设计建议以以下 5 个页面为优先对象：

1. 运行总览
2. 事件中心
3. 会话与运行轨迹
4. 生效运行时
5. Agent 验证台

这些页面一旦完成视觉设计，新 dash 的主骨架就基本确定。
