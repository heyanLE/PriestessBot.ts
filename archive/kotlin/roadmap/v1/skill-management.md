# skill-management — Skill 管理

提供技能管理能力，可插入自定义问答逻辑或能力增强。

## 核心抽象

- `Skill`：接口，定义 Skill 的名称、描述、优先级、`canHandle()` 判断是否可处理当前消息、`execute()` 执行处理逻辑
- `SkillManager`：管理多个 Skill 的注册、优先级排序、调用分发

## 内置实现

- `DefaultSkill`：默认问答 Skill，当消息不经 Pipeline 完全处理时提供兜底回答

一期 Skill 管理较为简单，二期将扩展为完整的插件接口，允许插件注册自定义 Skill。
