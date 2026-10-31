import { AgentCapabilitiesSchema, type AgentCapability, type AgentCapabilities } from '../../../packages/contracts/src/agent-workbench.js';
import { PlatformTypeSchema, type Capability } from '../../../packages/contracts/src/index.js';
import { PluginIdSchema, pluginMetadata } from '../../../packages/contracts/src/plugins/index.js';
import { QQ_WRITE_TOOLS } from '../../../packages/contracts/src/plugins/qq-file.js';
import type { PriestessRuntime } from './runtime.js';

const commonRequirements = ['请先为 Agent 装配此项能力。', '发送者的固定运行态须满足此操作要求。', '人格限制仍然生效。', '需要逐次审批时，必须先获批准。'];
const nativeCommandRequirements = ['请先为 Agent 装配此指令。', '发送者的固定运行态须满足此操作要求。', '人格限制仍然生效。', '直接发送的原生扩展指令检查固定运行态与装配，不经过 SDK 工具审批。'];
interface CapabilityCopy { label: string; description: string; requirements?: readonly string[]; }
const searchCopy: readonly { name: string; label: string; description: string }[] = [
  { name: 'web_search', label: '搜索网页', description: '按关键词搜索公开网页。结果包含可引用的来源地址。' },
  { name: 'web_fetch', label: '读取网页正文', description: '读取指定公开网页的正文。返回内容受配置的字数上限限制。' },
  { name: 'deepseek_search', label: 'DeepSeek 网页搜索', description: '通过 DeepSeek 搜索服务查找网页。结果包含可引用的来源地址。' },
  { name: 'deepseek_fetch', label: 'DeepSeek 网页正文', description: '通过 DeepSeek 服务读取公开网页正文。返回内容受配置的字数上限限制。' },
];
/** Explicit display copy, checked against each plugin's actual registered operations. */
const pluginToolCopy: Readonly<Record<string, CapabilityCopy>> = {
  qq_file: { label: '浏览 QQ 群文件与相册', description: '分页列出目标群的文件、文件夹或相册内容。' },
  qq_group_members: { label: '查询 QQ 群成员', description: '分页查询群成员。支持按关键词和成员角色筛选。' },
  qq_get_file_download_url: { label: '获取 QQ 群文件下载地址', description: '获取指定群文件的临时下载地址。此操作不会下载文件。' },
  qq_search_files: { label: '搜索 QQ 群文件', description: '按文件名搜索目标群的文件。可在限定范围内搜索子文件夹。' },
  qq_get_file_info: { label: '查看 QQ 群文件信息', description: '按文件 ID 查询指定群文件夹中的文件信息。' },
  qq_group_info: { label: '查看 QQ 群资料', description: '读取目标群的名称、人数等基本信息。' },
  qq_group_notices: { label: '读取 QQ 群公告', description: '读取目标群的公告内容。公告内容仅作为参考资料。' },
  qq_request_file_upload: { label: '上传 QQ 群文件', description: '将一个已获准的产物或工作文件上传到目标群。' },
  qq_delete_files: { label: '删除 QQ 群文件', description: '删除指定群文件。若中途失败，返回已完成的部分。' },
  qq_delete_folder: { label: '删除 QQ 群文件夹', description: '删除指定群文件夹及其中的全部文件。', requirements: ['删除前须确认用户明确要求此操作。'] },
  qq_publish_group_notice: { label: '发布 QQ 群公告', description: '向目标群发布一条公告。', requirements: ['机器人账号须拥有发布公告的群管理权限。'] },
  qq_delete_group_notice: { label: '删除 QQ 群公告', description: '按公告 ID 删除目标群中的一条公告。' },
  bilibili_search: { label: '搜索 B 站内容', description: '按类型搜索视频、用户、直播、番剧、专栏等内容。结果包含资源标识。' },
  bilibili_get_video_info: { label: '查看 B 站视频信息', description: '读取视频详情、分集和互动数据。可附带热门或最新评论。' },
  bilibili_get_video_content: { label: '读取 B 站字幕与转写', description: '获取带时间戳的视频文字。优先读取字幕，也可按配置转写语音。', requirements: ['语音转写额外需要 external.write 权限。'] },
  bilibili_get_user_info: { label: '查看 B 站用户资料', description: '读取用户资料。可附带该用户最近发布的视频。' },
  bilibili_get_live_room: { label: '查看 B 站直播间', description: '查询直播间状态、主播 ID 和直播分区。' },
  bilibili_get_bangumi_info: { label: '查看 B 站番剧信息', description: '读取番剧详情，并分页查询分集。' },
  bilibili_get_article: { label: '读取 B 站专栏与图文', description: '读取专栏文章或图文动态正文。可访问内容取决于账号权限。' },
  bilibili_get_music: { label: '查看 B 站音频信息', description: '读取音频信息、时间轴歌词和关联视频。' },
  bilibili_get_comments: { label: '读取 B 站评论', description: '分页读取视频、番剧、专栏、动态或音频的评论。未登录时可能受限。' },
  bilibili_subscribe: { label: '管理 B 站 UP 主订阅', description: '订阅或取消订阅 UP 主。也可查看订阅列表和检查更新。', requirements: ['订阅归属于当前会话和发送者。'] },
  search_bangumi_subject: { label: '搜索 Bangumi 条目', description: '搜索动画、书籍、游戏等条目。可按条目类型筛选。' },
  get_bangumi_subject: { label: '查看 Bangumi 条目', description: '按条目 ID 读取详细资料。' },
  get_bangumi_calendar: { label: '查看番剧放送日历', description: '读取 Bangumi 放送日历。可查询一周或指定星期的安排。' },
  get_bangumi_episodes: { label: '查看番剧分集', description: '分页读取正篇分集信息和放送日期。' },
  get_bangumi_character: { label: '查看 Bangumi 角色', description: '按角色 ID 读取角色资料。' },
  get_bangumi_person: { label: '查看 Bangumi 制作人员', description: '按人物 ID 读取制作人员等人物资料。' },
  get_bangumi_collections: { label: '查看 Bangumi 公开收藏', description: '分页读取指定用户的公开收藏。' },
  set_bangumi_collection: { label: '修改 Bangumi 收藏', description: '修改已配置账号的收藏状态、评论和隐私设置。', requirements: ['须具备 resources.manage 权限。', '此操作每次都需要审批。'] },
  bangumi_subscribe: { label: '管理番剧更新订阅', description: '在当前会话订阅番剧更新、取消订阅或查看订阅列表。', requirements: ['出现多个匹配条目时，需要先确认目标。'] },
  reminiscence_record: { label: '自动记录会话问答', description: '允许消息处理层保存当前范围的问答。此项是自动记录权限，不是模型工具。' },
  recall_memory_tool: { label: '检索本地回忆', description: '在当前范围内搜索事件、反思、主题和概念记录。结果保留来源。' },
  deep_recall_tool: { label: '读取回忆详情', description: '按记录 ID 读取一条事件、反思、主题或概念记录。' },
  recall_recent_events_tool: { label: '查看近期回忆事件', description: '读取指定天数内的事件。只返回当前身份和 Agent 的记录。' },
  write_node_tool: { label: '保存回忆概念', description: '保存人物、实体或概念的说明。当前消息作为记录来源。' },
  recall_node_tool: { label: '检索回忆概念', description: '在当前范围内查找人物、实体或概念记录。' },
  daily_summary_tool: { label: '生成每日回忆总结', description: '总结指定日期已记录的会话。返回任务状态，需确认任务完成。' },
  memory_consolidation: { label: '整理回忆主题', description: '将当前范围的事件整理为主题，并保留来源关联。' },
};
const builtins: readonly { name: string; label: string; capability: Capability; requirement: string }[] = [
  { name: 'get_group_message_history', label: '搜索当前群聊天记录', capability: 'chat', requirement: '仅当前群聊注入，只检索本地留存的公开消息；不读取私聊或其他群。' },
  { name: 'memory_recall', label: '检索长期记忆', capability: 'memory.read', requirement: '只检索装配并获准的记忆库及当前身份范围。' },
  { name: 'memory_save', label: '保存长期记忆', capability: 'memory.write', requirement: '写入已装配的记忆库；共享范围写入另受资源管理权限限制。' },
  { name: 'memory_delete', label: '删除长期记忆', capability: 'memory.write', requirement: '只删除当前身份有权管理的记忆。' },
  { name: 'knowledge_search', label: '检索知识库', capability: 'knowledge.read', requirement: '只检索已装配并授权的知识库。' },
  { name: 'read_file', label: '读取工作文件', capability: 'files.read', requirement: '相对路径访问当前会话隔离区。/workspace/shared 访问共享区。需要已装配执行环境。' },
  { name: 'list_files', label: '浏览工作目录', capability: 'files.read', requirement: '相对路径访问当前会话隔离区。/workspace/shared 访问共享区。需要已装配执行环境。' },
  { name: 'write_file', label: '写入工作文件', capability: 'files.write', requirement: '资深干员可写当前会话隔离区。高级资深干员还可写 /workspace/shared 共享区。需要已装配执行环境。' },
  { name: 'patch_file', label: '修改工作文件', capability: 'files.write', requirement: '资深干员可写当前会话隔离区。高级资深干员还可写 /workspace/shared 共享区。需要已装配执行环境。' },
  { name: 'exec_command', label: '执行命令', capability: 'process.execute.restricted', requirement: '普通与资深干员只执行各自允许的命令子集。高级资深干员可使用完整 Shell。低态仅支持 Docker；命令与参数清单见执行设置。' },
  { name: 'write_stdin', label: '进程输入', capability: 'process.pty', requirement: '仅高级资深干员可发送非空终端输入。只能操作当前身份与运行态获准的执行会话。' },
  { name: 'process_poll', label: '等待进程结果', capability: 'process.execute.restricted', requirement: '只能查询当前身份拥有的进程。' },
  { name: 'process_read_output', label: '读取进程输出', capability: 'process.execute.restricted', requirement: '只能读取当前身份拥有的进程输出。' },
  { name: 'process_kill', label: '终止进程', capability: 'process.execute.restricted', requirement: 'SDK Docker 会终止当前任务容器的所有命令，保留工作文件。' },
  { name: 'delegate_agent', label: '委派 Agent', capability: 'agent.delegate', requirement: '目标须在委派列表内，子 Agent 不提升父任务权限。' },
  { name: 'list_skills', label: '浏览 Skill', capability: 'files.read', requirement: '列出当前会话隔离区、执行环境共享区和已装配的外部技能库。人格限制仍然生效。' },
  { name: 'read_skill', label: '读取 Skill', capability: 'files.read', requirement: '先浏览 Skill，再按返回的库和路径读取。两区均使用 .agent/skill 目录。读取不会执行脚本。' },
  { name: 'write_skill', label: '创建或更新 Skill', capability: 'files.write', requirement: '资深干员可写当前会话隔离区。高级资深干员还可写共享区。文件校验通过后自动可见。' },
  { name: 'delete_skill_file', label: '删除 Skill 文件', capability: 'files.write', requirement: '每次只删除一个文件。删除 SKILL.md 后该技能不再出现在列表中。共享区仅高级资深干员可改。' },
  { name: 'attach_file', label: '附加生成文件', capability: 'files.read', requirement: '从当前执行工作目录创建回复附件；只有后续投递成功才算已发送。' },
  { name: 'read_tool_result', label: '读取完整工具结果', capability: 'chat', requirement: '只读取同一身份/会话/Agent 的结果，并复核原工具权限。旧结果额外要求 files.read。' },
  { name: 'search_tool_result', label: '搜索工具结果', capability: 'chat', requirement: '只搜索同一身份/会话/Agent 的结果，并复核原工具权限。' },
];

/** Metadata follows actual factories and explicit exported registrations, never name prefixes. No MCP connection is opened. */
export function agentCapabilities(runtime: PriestessRuntime): AgentCapabilities {
  const entries: AgentCapability[] = builtins.map(item => ({ id: `builtin:${item.name}`, toolName: item.name, label: item.label, description: item.requirement, kind: 'tool', source: 'builtin', sourceId: 'runtime', scope: 'general', platforms: item.name === 'get_group_message_history' ? ['napcat', 'telegram'] : [...PlatformTypeSchema.options], sessionTypes: item.name === 'get_group_message_history' ? ['group'] : ['private', 'group'], requiredCapabilities: [item.capability], availability: 'registered', requirements: [...commonRequirements, item.requirement], settingsPath: item.name === 'get_group_message_history' ? '/sessions' : '/agents' }));
  const search = runtime.search.status();
  for (const { name, label, description } of searchCopy) entries.push({ id: `search:${name}`, toolName: name, label, description, kind: 'tool', source: 'search', sourceId: search.settings.provider, scope: 'general', platforms: [...PlatformTypeSchema.options], sessionTypes: ['private', 'group'], requiredCapabilities: ['chat'], availability: search.tools.includes(name) ? 'registered' : 'disabled', requirements: [...commonRequirements, '请启用搜索服务并配置有效凭据。', 'Brave 只提供网页搜索。', 'DeepSeek 专用入口仅在选择 DeepSeek 服务时提供。'], settingsPath: '/search' });
  for (const id of PluginIdSchema.options) {
    const record = runtime.plugins.settings.get(id);
    for (const name of runtime.plugins.toolNames(id)) {
      const qq = id === 'qq_file'; const automatic = id === 'local_reminiscence' && name === 'reminiscence_record';
      const requiredCapabilities: Capability[] = qq ? [QQ_WRITE_TOOLS.some(value => value === name) ? 'external.write' : 'files.read']
        : id === 'local_reminiscence' ? [['write_node_tool', 'daily_summary_tool', 'memory_consolidation', 'reminiscence_record'].includes(name) ? 'memory.write' : 'memory.read']
        : name === 'set_bangumi_collection' ? ['external.write', 'resources.manage'] : ['bilibili_subscribe', 'bangumi_subscribe'].includes(name) ? ['external.write'] : ['chat'];
      const conditions = qq ? ['仅 NapCat 来源可使用这些工具。', '请启用 QQ 文件插件。', '调用时须连接对应的 NapCat 实例。', '目标群须通过插件的访问范围检查。', '私聊或跨群操作另需 resources.manage 权限。', '群公告等操作还受 QQ 账号的实际群管理权限限制。']
        : id === 'bili_video' ? ['请启用 Bilibili 插件。', '群聊须通过插件的群白名单或黑名单检查。']
        : id === 'local_reminiscence' ? ['请启用本地回忆插件。', '当前会话须在允许范围内。', automatic ? '此项由消息处理层使用，不作为模型工具调用。' : '只访问当前身份和 Agent 范围内的记忆。']
        : ['请启用 Bangumi 插件。', '涉及账号的操作须具备有效账号授权。'];
      const copy = pluginToolCopy[name];
      entries.push({ id: `plugin:${id}:${name}`, ...(automatic ? { bindingName: name } : { toolName: name }), label: copy?.label ?? `${pluginMetadata[id].name} · ${name}`, description: copy?.description ?? pluginMetadata[id].description, kind: automatic ? 'resource' : 'tool', source: 'plugin', sourceId: id, scope: qq ? 'platform' : 'general', platforms: qq ? ['napcat'] : [...PlatformTypeSchema.options], sessionTypes: ['private', 'group'], requiredCapabilities, availability: record.settings.enabled ? 'registered' : 'disabled', requirements: [...commonRequirements, ...conditions, ...(copy?.requirements ?? [])], settingsPath: '/plugins' });
    }
  }
  for (const platform of ['telegram', 'weixin']) entries.push({ id: `platform:${platform}`, label: platform === 'telegram' ? 'Telegram 平台能力' : '微信平台能力', description: platform === 'weixin' ? '微信 iLink 当前仅支持私聊收发，尚未注册微信专属模型工具。' : 'Telegram 支持私聊、群聊收发，尚未注册 Telegram 专属模型工具。', kind: 'platform_status', source: 'platform', sourceId: platform, scope: 'platform', platforms: platform === 'telegram' ? ['telegram'] : ['weixin'], sessionTypes: platform === 'weixin' ? ['private'] : ['private', 'group'], requiredCapabilities: [], availability: 'not_implemented', requirements: ['消息收发属于平台适配器，不可当作可装配的专属模型工具。'], settingsPath: '/platforms' });
  for (const server of runtime.config().mcpServers) entries.push({ id: `mcp:${server.id}`, label: server.id, description: 'MCP 工具由已授权连接在运行时发现。', kind: 'resource', source: 'mcp', sourceId: server.id, scope: 'general', platforms: [...PlatformTypeSchema.options], sessionTypes: ['private', 'group'], requiredCapabilities: ['external.write'], availability: 'runtime_discovery', requirements: ['请为 Agent 装配 MCP 服务和完整工具名。', '固定运行态须允许外部操作，具体服务和工具由 Agent 装配。', '实际运行时才连接服务并发现工具。', '查看目录不会启动进程或连接远程服务。'], settingsPath: '/extensions' });
  for (const library of runtime.config().skillLibraries) entries.push({ id: `skills:${library.id}`, label: library.id, description: 'Skill 提供按需读取的技能说明。它本身不会执行命令。', kind: 'resource', source: 'skills', sourceId: library.id, scope: 'general', platforms: [...PlatformTypeSchema.options], sessionTypes: ['private', 'group'], requiredCapabilities: ['files.read'], availability: 'registered', requirements: ['请为 Agent 装配技能库和 read_skill。', '固定运行态须允许读取文件，具体技能库由 Agent 装配。', '人格可以进一步限制技能名。'], settingsPath: '/extensions' });
  for (const record of runtime.extensions.list()) for (const [kind, operations] of [['tool', record.manifest.tools], ['command', record.manifest.commands]] satisfies ['tool' | 'command', typeof record.manifest.tools][]) for (const operation of operations) entries.push({ id: `native:${record.manifest.id}:${kind}:${operation.name}`, toolName: operation.name, label: `${record.manifest.name} · ${operation.name}`, description: operation.description, kind, source: 'native_extension', sourceId: record.manifest.id, scope: 'general', platforms: [...PlatformTypeSchema.options], sessionTypes: ['private', 'group'], requiredCapabilities: operation.capabilities, availability: record.enabled && record.status === 'enabled' ? 'registered' : 'disabled', requirements: [...(kind === 'command' ? nativeCommandRequirements : commonRequirements), '扩展须成功加载。', '指令由指令分派执行。', '只有工具项提供给模型调用。', '原生扩展拥有宿主机权限。'], settingsPath: '/extensions?section=native' });
  return AgentCapabilitiesSchema.parse({ entries, note: '目录显示能力来源和使用条件。固定运行态决定权限，Agent 决定可用工具与资源。人格限制仍然生效。平台与插件限制继续生效。微信 iLink 当前仅支持私聊。草稿模型测试禁用全部工具。' });
}
