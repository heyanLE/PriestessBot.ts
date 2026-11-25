# 规范依据

核验日期 2026-11-14。以下材料启发了本项目的原创规范和示例。

- Agent Skills 规范推荐将入口说明与按需参考资料放在同一目录，保持入口简洁。[规范](https://agentskills.io/specification)
- Anthropic 的工程文章介绍从 metadata 到 SKILL.md 再到参考文件的渐进式加载。本插件自动提供短索引，模型通过 read_skill 读取选中剧本。[文章](https://www.anthropic.com/research/equipping-agents-for-the-real-world-with-agent-skills)
- ASD-STE100 是技术英语规范。参考单句单一主题、短句、段落单一主题和一致术语。官方 Issue 9 搜索索引可访问，全文抓取返回 403，本次未完成逐条全文审核。中文规则只做原则借鉴。[官方 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf)
- W3C 认知可访问性补充建议采用常见词、解释生僻术语和避免含糊词。这些是补充设计建议。[Use Clear Words](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o3p01-clear-words/)
- ayghri/i-have-adhd 是 MIT 许可的社区 Skill。借鉴答案或动作前置、有限的可见步骤、减少枝节，同时保持完整解释。它不是临床研究，本项目不采用对读者诊断、固定记忆能力或神经机制的断言，也不采用跨会话常驻规则。[原仓库](https://github.com/ayghri/i-have-adhd/blob/main/skills/i-have-adhd/SKILL.md)

评估应检查任务完成、证据准确、理解成本、冗余和工具调用次数。不要用字数越少得分越高来替代质量评估。
