# 固定运行态授权

三态权限表由 `runtimeStateCapabilities` 定义并冻结。发送者授权只保存平台、多个精确发送者 ID 和一个运行态。Agent 选择具体工具、知识库、技能、目录和执行环境；人格与平台条件继续收窄可用范围。

| 运行态 | 固定权限 |
| --- | --- |
| 普通干员态 | 对话、读取知识库、读取和写入当前范围记忆、读取获准文件、停止自己的会话任务、委派获准 Agent、容器内受限读取命令 |
| 资深干员态 | 普通干员权限，加写文件、受限文件整理与下载命令、外部写入、重置会话 |
| 高级资深干员态 | 资深干员权限，加完整 Shell、终端输入、资源管理和管理能力 |

角色不会装配工具，也不会绕过目录、目标群、记忆作用域、人格或逐次审批。子 Agent 的角色和资源不得超过父任务；审批恢复时重新检查配置修订、授权版本和当前角色。

## 数据形状与兼容

```json
{
  "platform": "napcat-main",
  "senderIds": ["10001", "10002"],
  "state": "elite_operator"
}
```

旧会话范围通过可选 `sessionType` 和 `sessionId` 保留。更具体的会话规则优先于平台级规则。同范围、同 ID 的不同运行态会被拒绝。ID 按字符串精确匹配，不支持前缀或通配符匹配。

旧 `senderId/defaultState/maximumState/capabilities/resources` 可读取并转为新形状。角色只取旧 `defaultState`；没有默认值时采用普通干员态。旧最高态不会自动成为新角色。旧默认态高于旧最高态的无效配置会被拒绝。

旧的细粒度发送者能力与资源限制不再使用，旧 Agent `capabilities` 字段只为历史数据兼容保留。权限现由固定表决定，因此迁移不是逐项权限不变的转换。迁移报告会给出退出使用的旧策略数量。历史 `requested-state` 记录保留，但不能覆盖管理员分配。`/state` 查看当前角色；指定不同角色会被拒绝。

## 离线迁移

工具直接使用 SQLite API，不实例化 `RuntimeStore`，不会因读取数据库而标记运行任务中断。

```sh
node dist/tools/migrate-fixed-states.js --database /absolute/path/runtime.sqlite
node dist/tools/migrate-fixed-states.js --database /absolute/path/runtime.sqlite --apply --runtime-stopped
```

先停止运行服务，再执行应用命令。工具拒绝存在运行中、排队或等待审批的任务。应用前创建 0600 数据库备份，随后在事务中增加一个配置修订，并同步增加 `flow.revision`。旧修订、人格、消息、会话和历史请求态记录均保留。报告不输出发送者 ID 或凭据。

canonical 授权形状不能直接由旧版服务读取。需要回退时，停止新版服务，用原修订生成一个更高的兼容配置修订：

```sh
node dist/tools/migrate-fixed-states.js --database /absolute/path/runtime.sqlite --rollback-revision 10 --apply --runtime-stopped
```

示例中的 10 应替换为迁移报告的 `sourceRevision`。回退保留旧配置的原始形状，不删除切换后产生的消息和人格数据；之后再启动旧发布版本。不得仅切换代码目录后让旧服务读取新形状。

执行命令分为 `process.execute.restricted` 与 `process.execute`。普通和资深干员只拥有前者。旧 `process.execute` 与 `process.pty` 只属于高级资深干员，不能因开放内置受限命令而同时开放原生扩展中的任意执行器。命令子集与参数规则见 `restricted-command-policy.md`。
