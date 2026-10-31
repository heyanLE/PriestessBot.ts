<script setup lang="ts">
import { randomId } from '../../utils/random-id';
import ContextPolicyEditor from './ContextPolicyEditor.vue';
import AgentPromptConfiguration from './AgentPromptConfiguration.vue';
import { computed, ref } from 'vue';
import { confirmUnsavedDrafts, confirmDestructiveAction } from '../../composables/unsaved';
import { AgentDefinitionSchema, AgentIdSchema, PlatformConfigSchema, PlatformsResponseSchema, type RuntimeConfig, type PlatformType } from '../../../../packages/contracts/src/index';
import SenderAuthorizationEditor from './SenderAuthorizationEditor.vue';
import RuntimeStatePermissions from './RuntimeStatePermissions.vue';
import ResourceEditor from './ResourceEditor.vue';
import NamedBindingPicker from './NamedBindingPicker.vue';
const config = defineModel<RuntimeConfig>({ required: true });
const props = withDefaults(defineProps<{ section?: 'agents' | 'platforms' | 'grants' | 'resources'; publishedAgentIds?: readonly string[]; extraToolOptions?: {id:string;label:string;detail:string}[]; platformStatuses?: ReturnType<typeof PlatformsResponseSchema.parse>['platforms'] }>(), { section: 'agents', extraToolOptions: () => [], platformStatuses: () => [] });
type AgentTab = 'profile' | 'resources' | 'permissions' | 'budget' | 'context';
const agentTab = ref<AgentTab>('profile');
const agentTabs: { id: AgentTab; label: string }[] = [{ id:'profile', label:'基本设置与人格' }, { id:'resources', label:'资源与工具' }, { id:'permissions', label:'权限与审批' }, { id:'budget', label:'执行与委派' }, { id:'context', label:'上下文与压缩' }];
const platformIndex = ref(0);
const platform = computed(() => config.value.platforms[platformIndex.value]);
const platformNames: Record<PlatformType,string> = { telegram:'Telegram', napcat:'NapCat / OneBot v11', weixin:'微信 iLink' };
const statusLabels = { disabled:'未启用', starting:'连接中', connected:'已连接', error:'连接异常', stopped:'已停止' };
function platformStatus(id:string) { return props.platformStatuses.find(item=>item.id===id); }
function platformStatusLabel(id:string, enabled:boolean) { const status=platformStatus(id); return status ? statusLabels[status.status] : enabled ? '待保存连接' : '未启用'; }
function removePlatform() { if(!platform.value || !confirmDestructiveAction(`从草稿移除机器人“${platform.value.displayName || platform.value.id}”？发布运行配置后会断开此机器人。`))return;config.value.platforms.splice(platformIndex.value,1); platformIndex.value=Math.max(0,Math.min(platformIndex.value,config.value.platforms.length-1)); }
interface ResourceGroup { field: 'memoryLibraries' | 'knowledgeLibraries' | 'mcpServers' | 'skills'; label: string; options: { id: string; label: string; detail: string }[] }
const resourceGroups=computed<ResourceGroup[]>(()=>[
{field:'memoryLibraries',label:'长期记忆库',options:config.value.memoryLibraries.map(item=>({id:item.id,label:item.displayName,detail:item.id}))},
{field:'knowledgeLibraries',label:'知识库',options:config.value.knowledgeLibraries.map(item=>({id:item.id,label:item.displayName,detail:item.id}))},
{field:'mcpServers',label:'MCP 服务',options:config.value.mcpServers.map(item=>({id:item.id,label:item.id,detail:item.transport}))},
{field:'skills',label:'Skill 库',options:config.value.skillLibraries.map(item=>({id:item.id,label:item.id,detail:item.directory}))},
]);
const builtinToolOptions=[
{id:'get_group_message_history',label:'搜索群聊天记录',detail:'当前群已保存消息：关键词、发送者与分页检索'},
{id:'memory_recall',label:'检索记忆',detail:'memory_recall'},{id:'memory_save',label:'写入记忆',detail:'memory_save'},{id:'memory_delete',label:'删除记忆',detail:'memory_delete'},
{id:'knowledge_search',label:'检索知识库',detail:'knowledge_search'},{id:'read_file',label:'读取文件',detail:'read_file'},{id:'list_files',label:'浏览目录',detail:'list_files'},{id:'write_file',label:'写入文件',detail:'write_file'},{id:'patch_file',label:'修改文件',detail:'patch_file'},
{id:'exec_command',label:'执行命令',detail:'exec_command'},{id:'write_stdin',label:'终端输入',detail:'write_stdin'},{id:'process_poll',label:'查询进程',detail:'process_poll'},{id:'process_read_output',label:'分段读取进程输出',detail:'process_read_output'},{id:'process_kill',label:'停止进程',detail:'process_kill'},
{id:'delegate_agent',label:'委派 Agent',detail:'delegate_agent'},{id:'read_skill',label:'读取 Skill',detail:'read_skill'},{id:'list_skills',label:'浏览 Skill',detail:'list_skills'},{id:'write_skill',label:'创建或更新 Skill',detail:'write_skill'},{id:'delete_skill_file',label:'删除 Skill 文件',detail:'delete_skill_file'},{id:'read_tool_result',label:'读取工具长结果',detail:'read_tool_result'},{id:'search_tool_result',label:'搜索工具长结果',detail:'search_tool_result'},{id:'attach_file',label:'发送生成文件',detail:'attach_file'}];
const toolOptions=computed(()=>[...builtinToolOptions,...props.extraToolOptions.filter(item=>!builtinToolOptions.some(builtin=>builtin.id===item.id))]);
const extraToolName=ref('');
function addToolBinding(){const name=extraToolName.value.trim();if(agent.value && name && !agent.value.resources.tools.includes(name))agent.value.resources.tools.push(name);extraToolName.value='';}
const agentId = ref('');
const agent = computed(() => config.value.agents.find(item => item.id === agentId.value) ?? config.value.agents[0]);
const platformType = ref<PlatformType>('telegram');
function chooseAgent(id:string){if(agent.value?.id===id||confirmUnsavedDrafts('/agents'))agentId.value=id;}
function chooseAgentTab(id:AgentTab){if(agentTab.value===id||confirmUnsavedDrafts('/agents'))agentTab.value=id;}
function addAgent() { if(!confirmUnsavedDrafts('/agents'))return;const item = AgentDefinitionSchema.parse({ id: `agent-${randomId().slice(0,8)}`, displayName: '新 Agent', connectionId: config.value.connections[0]?.id ?? 'default' }); config.value.agents.push(item); agentId.value = item.id; agentTab.value = 'profile'; }
function addPlatform() {
  const id = `${platformType.value}-${randomId().slice(0,6)}`;
  const item = platformType.value === 'napcat' ? PlatformConfigSchema.parse({ id, type:'napcat', websocketUrl:'ws://127.0.0.1:3001' }) : platformType.value === 'telegram' ? PlatformConfigSchema.parse({ id, type:'telegram', tokenEnv:'TELEGRAM_TOKEN' }) : PlatformConfigSchema.parse({ id, type:'weixin' });
  item.displayName = `${platformNames[item.type]} 机器人`; config.value.platforms.push(item); platformIndex.value=config.value.platforms.length-1;
}
function setNapcatApiBase(index:number,event:Event){const platform=config.value.platforms[index];if(platform?.type!=='napcat'||!(event.target instanceof HTMLInputElement))return;if(event.target.value.trim())platform.apiBase=event.target.value.trim();else delete platform.apiBase;}
function setNapcatPreAckEmojis(index:number,event:Event){const platform=config.value.platforms[index];if(platform?.type!=='napcat'||!(event.target instanceof HTMLTextAreaElement))return;platform.preAckEmoji.emojis=event.target.value.split('\n').map(value=>value.trim()).filter(Boolean);}
function setBinding(field: 'memoryLibraries' | 'knowledgeLibraries' | 'skills' | 'mcpServers' | 'tools' | 'directories', event: Event) { if (agent.value && event.target instanceof HTMLTextAreaElement) agent.value.resources[field] = event.target.value.split('\n').map(value => value.trim()).filter(Boolean); }
function toggleMemoryExtraction(event:Event){if(!agent.value||!(event.target instanceof HTMLInputElement))return;agent.value.memoryExtraction.enabled=event.target.checked;if(event.target.checked&&!agent.value.memoryExtraction.libraryId){const libraryId=agent.value.resources.memoryLibraries[0];if(libraryId)agent.value.memoryExtraction.libraryId=libraryId;}}
function setExtractionLibrary(event:Event){if(!agent.value||!(event.target instanceof HTMLSelectElement))return;if(event.target.value)agent.value.memoryExtraction.libraryId=event.target.value;else delete agent.value.memoryExtraction.libraryId;}
function setApprovalTools(event:Event){if(agent.value&&event.target instanceof HTMLTextAreaElement)agent.value.approvalTools=event.target.value.split('\n').map(value=>value.trim()).filter(Boolean);}
function setDelegates(event: Event) { if (agent.value && event.target instanceof HTMLSelectElement) agent.value.delegationTargets = Array.from(event.target.selectedOptions).map(option => AgentIdSchema.parse(option.value)); }
</script>
<template>
<div class="ts-fields">
  <ResourceEditor v-if="section === 'resources'" v-model="config"/>
  <template v-if="section === 'agents'">
    <div class="ts-entity-layout ts-configuration-workbench">
      <aside class="ts-object-list"><div class="section-title"><h2>Agent <small>{{ config.agents.length }}</small></h2><button @click="addAgent">新增</button></div><button v-for="item in config.agents" :key="item.id" :class="{selected:agent?.id === item.id}" @click="chooseAgent(item.id)"><strong>{{ item.displayName }}</strong><small>{{ item.model }} · {{ item.enabled?'启用':'停用' }}</small></button></aside>
      <section v-if="agent" class="ts-fields ts-object-editor">
        <div class="section-title"><div><h2>{{ agent.displayName }}</h2><p>{{ agent.id }}</p></div><label class="ts-check"><input v-model="agent.enabled" type="checkbox">启用 Agent</label></div>
        <nav class="ts-tabs" aria-label="Agent 设置"><button v-for="item in agentTabs" :key="item.id" :class="{active:agentTab===item.id}" @click="chooseAgentTab(item.id)">{{ item.label }}</button></nav>
        <div v-if="agentTab==='profile'" class="ts-fields">
          <div class="ts-form-grid"><label>显示名称<input v-model="agent.displayName"></label><label>模型服务<select v-model="agent.connectionId"><option v-if="!config.connections.some(item=>item.id===agent?.connectionId)" :value="agent.connectionId">{{ agent.connectionId }}（未登记）</option><option v-for="connection in config.connections" :key="connection.id" :value="connection.id">{{ connection.id }} · {{ connection.protocol==='responses'?'Responses':'Chat Completions' }}</option></select></label><label>模型名称<input v-model="agent.model" placeholder="填写模型服务支持的模型名"></label><label>执行引擎<input value="OpenAI Agents SDK" readonly></label></div>
          <AgentPromptConfiguration :key="agent.id" :model-value="agent" :persisted="publishedAgentIds===undefined || publishedAgentIds.includes(agent.id)" @update:model-value="Object.assign(agent, $event)"/>
        </div>
        <div v-if="agentTab==='resources'" class="ts-fields">
          <p class="muted">选择 Agent 可以使用的资源。实际调用还会遵守当前发送者的授权。</p>
          <div class="ts-form-grid"><NamedBindingPicker v-for="group in resourceGroups" :key="group.field" v-model="agent.resources[group.field]" :label="group.label" :options="group.options"/></div>
          <NamedBindingPicker v-model="agent.resources.tools" label="工具与扩展指令" :options="toolOptions"/><div class="toolbar"><label>其他工具名称（例如已接入的 MCP 工具）<input v-model="extraToolName" placeholder="工具名称"></label><button type="button" @click="addToolBinding">装配工具</button></div>
          <div class="ts-form-grid"><label>执行环境<select v-model="agent.resources.executionEnvironment"><option value="none">不使用执行环境</option><option v-if="agent.resources.executionEnvironment!=='none'&&!config.executionEnvironments.some(item=>item.id===agent?.resources.executionEnvironment)" :value="agent.resources.executionEnvironment">{{ agent.resources.executionEnvironment }}（未登记）</option><option v-for="environment in config.executionEnvironments" :key="environment.id" :value="environment.id">{{ environment.id }} · {{ environment.type==='sdk_docker'?'SDK Docker':environment.type==='docker'?'Docker':'本机' }} · {{ environment.root }}</option></select></label><label>目录白名单（每行一个）<textarea :value="agent.resources.directories.join('\n')" rows="3" @change="setBinding('directories',$event)"></textarea></label></div>
          <div class="card ts-fields"><label class="ts-check"><input type="checkbox" :checked="agent.memoryExtraction.enabled" @change="toggleMemoryExtraction">自动提取长期记忆</label><label v-if="agent.memoryExtraction.enabled">写入记忆库<select :value="agent.memoryExtraction.libraryId ?? ''" @change="setExtractionLibrary"><option value="">选择已装配的记忆库</option><option v-if="agent.memoryExtraction.libraryId&&!config.memoryLibraries.some(item=>item.id===agent?.memoryExtraction.libraryId&&agent?.resources.memoryLibraries.includes(item.id))" :value="agent.memoryExtraction.libraryId">{{ agent.memoryExtraction.libraryId }}（未装配）</option><option v-for="library in config.memoryLibraries.filter(item=>agent?.resources.memoryLibraries.includes(item.id))" :key="library.id" :value="library.id">{{library.displayName}}</option></select></label><p class="muted">仅私聊自动提取，记忆按当前会话与发送者隔离；群聊不会自动提取或自动提升到共享范围。共享记忆的手动写入还需要 resources.manage 授权；定期整理在记忆页按现有范围单独启用。</p></div>
        </div>
        <div v-if="agentTab==='permissions'" class="ts-fields"><RuntimeStatePermissions/><label>权限不足时的回复<input v-model="agent.permissionDenied"></label><label>需要逐次审批的工具名（每行一个）<textarea :value="agent.approvalTools.join('\n')" rows="4" @change="setApprovalTools"></textarea></label><p class="muted">调用这些工具时暂停执行，在会话时间线中批准或拒绝。工具名与资源页显示的名称一致。</p></div>
        <ContextPolicyEditor v-if="agentTab==='context'" v-model="agent.contextPolicy" :connections="config.connections" :agent-model="agent.model"/>
        <div v-if="agentTab==='budget'" class="ts-fields"><div class="ts-form-grid"><label>最大轮数<input v-model.number="agent.budget.maxTurns" type="number" min="1" max="100"></label><label>Token 限制模式<select v-model="agent.budget.tokenLimitMode"><option value="cumulative">累计预算（预留收尾空间）</option><option value="context">上下文、轮数与超时限制</option></select></label><label>{{agent.budget.tokenLimitMode==='cumulative'?'整次任务 Token 预算':'单次输出预算上限'}}<input v-model.number="agent.budget.maxTokens" type="number" min="1" max="1000000"></label><label>超时（毫秒）<input v-model.number="agent.budget.timeoutMs" type="number" min="100" max="3600000"></label><label>最大委派深度<input v-model.number="agent.budget.maxDelegationDepth" type="number" min="0" max="8"></label><label>最大委派次数<input v-model.number="agent.budget.maxDelegations" type="number" min="0" max="32"></label><label>并行子 Agent 上限<input v-model.number="agent.budget.maxConcurrentChildren" type="number" min="1" max="8"></label><label>可委派 Agent<select multiple :value="agent.delegationTargets" @change="setDelegates"><option v-for="target in config.agents.filter(item=>item.id!==agent?.id)" :key="target.id" :value="target.id">{{ target.displayName }}</option><option v-for="id in agent.delegationTargets.filter(value=>!config.agents.some(item=>item.id===value))" :key="id" :value="id">{{ id }}（未登记）</option></select></label></div></div>
      </section>
    </div>
  </template>
  <template v-if="section === 'platforms'">
    <div class="section-title"><div><h2>机器人</h2><p>接入 IM 平台，在右侧配置连接并查看运行状态。</p></div><div class="toolbar"><select v-model="platformType" aria-label="新增平台类型"><option v-for="(name,type) in platformNames" :key="type" :value="type">{{ name }}</option></select><button @click="addPlatform">添加机器人</button></div></div>
    <div class="ts-entity-layout ts-configuration-workbench">
      <aside class="ts-object-list"><div class="section-title"><h3>我的机器人 <small>{{ config.platforms.length }}</small></h3></div><button v-for="(item,index) in config.platforms" :key="index" :class="{selected:platformIndex===index}" @click="platformIndex=index"><strong>{{ item.displayName || item.id }}</strong><span>{{ platformNames[item.type] }}</span><small :class="{'danger':platformStatus(item.id)?.status==='error'}">{{ platformStatusLabel(item.id,item.enabled) }}</small></button><p v-if="!config.platforms.length" class="empty-state">还没有机器人，选择平台并添加。</p></aside>
      <section v-if="platform" class="ts-fields ts-object-editor">
        <div class="section-title"><div><h2>{{ platform.displayName || platform.id }}</h2><p>{{ platformNames[platform.type] }}</p></div><label class="ts-check"><input v-model="platform.enabled" type="checkbox">启用机器人</label></div>
        <div class="card ts-platform-summary"><span :class="{'danger':platformStatus(platform.id)?.status==='error'}">{{ platformStatusLabel(platform.id,platform.enabled) }}</span><p v-if="platformStatus(platform.id)?.message" class="muted">{{ platformStatus(platform.id)?.message }}</p><p class="muted">保存配置后应用连接设置。运行状态来自适配器。</p></div>
        <div class="ts-form-grid"><label>机器人名称<input v-model="platform.displayName" placeholder="方便区分的名称"></label><label>实例 ID<input v-model="platform.id"></label></div>
        <h3>连接设置</h3><div class="ts-form-grid">
          <template v-if="platform.type==='telegram'"><label>Bot Token 环境变量名<input v-model="platform.tokenEnv" autocomplete="off"></label><label>API 地址<input v-model="platform.apiBase" type="url"></label><label>长轮询超时（秒）<input v-model.number="platform.pollingTimeoutSeconds" type="number" min="1" max="60"></label></template>
          <template v-if="platform.type==='napcat'"><label>WebSocket 地址<input v-model="platform.websocketUrl" placeholder="ws://127.0.0.1:3001"></label><label>访问令牌环境变量名<input v-model="platform.accessTokenEnv" autocomplete="off"></label><label>HTTP API 地址（可选）<input :value="platform.apiBase" @change="setNapcatApiBase(platformIndex,$event)" type="url"></label></template>
          <template v-if="platform.type==='weixin'"><label>iLink API 地址<input v-model="platform.apiBase" type="url"></label><label>Token 环境变量名<input v-model="platform.tokenEnv" autocomplete="off"></label><label>账号 ID<input v-model="platform.accountId"></label><label>登录状态文件<input v-model="platform.stateFile"></label></template>
        </div><p class="muted">凭据从本机服务端环境变量读取，此处填写变量名。</p>
        <div v-if="platform.type==='napcat'" class="card ts-fields"><h3>消息防刷屏</h3><label>合并转发字数阈值<input v-model.number="platform.forwardThreshold" type="number" min="0" max="200000" step="1"></label><p class="muted">群聊和私聊回复超过此字数时，折叠为一条合并转发消息，不再分页刷屏。默认 1500 字，设为 0 关闭。</p></div>
        <div v-if="platform.type==='napcat'" class="card ts-fields"><h3>开始处理表情</h3><label class="ts-check"><input v-model="platform.preAckEmoji.enabled" type="checkbox">开始处理时给触发消息贴表情</label><label>表情列表（每行一个，最多 32 个）<textarea :value="platform.preAckEmoji.emojis.join('\n')" :disabled="!platform.preAckEmoji.enabled" rows="4" placeholder="124&#10;👀&#10;🤔" @change="setNapcatPreAckEmojis(platformIndex,$event)"></textarea></label><p class="muted">仅群聊生效。机器人实际开始处理时，从列表随机选一个贴到触发消息上；排队等待时不贴，处理完成后保留。列表留空则不贴。</p><p class="muted">支持 QQ 表情数字 ID，例如 124（OK）、76（赞）、66（爱心），或单个 Unicode 表情，例如 👀、🤔、❤️。不支持多人、肤色、旗帜等复杂组合表情。贴表情失败不会影响回复。</p></div>
        <slot v-if="platform.type==='weixin'" name="platform-login" :platform="platform"></slot>
        <div class="toolbar"><button class="danger" @click="removePlatform">移除机器人配置</button></div>
      </section><div v-else class="empty-state">添加机器人后，选择一个机器人开始配置连接。</div>
    </div>
  </template>
  <SenderAuthorizationEditor v-if="section === 'grants'" v-model="config"/>
</div>
</template>
<style scoped>
.ts-configuration-workbench{min-height:420px}.ts-object-editor{border-left:1px solid var(--line);padding-left:24px}.ts-object-editor h3{font-size:14px;margin:4px 0}.ts-platform-summary{padding:14px 16px}.ts-platform-summary p{margin:8px 0 0;font-size:12px}.ts-object-list h3{font-size:14px}.ts-object-list h3 small{font-weight:400;color:var(--muted)}
@media(max-width:900px){.ts-object-editor{border-left:0;border-top:1px solid var(--line);padding-left:0;padding-top:20px}.ts-configuration-workbench{min-height:0}}
</style>
