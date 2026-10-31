<script setup lang="ts">
import { confirmDestructiveAction } from '../../composables/unsaved';
import { randomId } from '../../utils/random-id';
import { computed, ref, watch } from 'vue';
import { ConnectionSchema, ExecutionEnvironmentSchema, McpServerConfigSchema, type RuntimeConfig } from '../../../../typescript/packages/contracts/src/index';
type ResourceSection = 'connections' | 'memoryLibraries' | 'knowledgeLibraries' | 'extensions' | 'environments';
const props = withDefaults(defineProps<{ section?: ResourceSection }>(), { section: 'connections' });
const config = defineModel<RuntimeConfig>({ required: true });
const extension = ref<'mcp' | 'skills'>('mcp');
const selectedIndex = ref(0);
const search = ref('');
const titles: Record<ResourceSection, string> = { connections: '模型服务', memoryLibraries: '记忆库', knowledgeLibraries: '知识库', extensions: '扩展', environments: '执行环境' };
const itemLabel = computed(() => props.section === 'extensions' ? (extension.value === 'mcp' ? 'MCP 服务' : 'Skills 资源库') : titles[props.section]);
const entries = computed(() => {
  switch (props.section) {
    case 'connections': return config.value.connections.map((item, index) => ({ index, title: item.id, detail: item.baseUrl || 'OpenAI', badge: item.protocol === 'responses' ? 'Responses' : 'Chat Completions' }));
    case 'memoryLibraries': return config.value.memoryLibraries.map((item, index) => ({ index, title: item.displayName || item.id, detail: item.id, badge: '长期记忆' }));
    case 'knowledgeLibraries': return config.value.knowledgeLibraries.map((item, index) => ({ index, title: item.displayName || item.id, detail: item.id, badge: '知识检索' }));
    case 'environments': return config.value.executionEnvironments.map((item, index) => ({ index, title: item.id, detail: item.root, badge: item.type === 'sdk_docker' ? 'SDK Docker' : item.type === 'docker' ? 'Docker' : '本机' }));
    case 'extensions': return extension.value === 'mcp' ? config.value.mcpServers.map((item, index) => ({ index, title: item.id, detail: item.transport === 'stdio' ? item.command || '未设置启动命令' : item.url || '未设置地址', badge: item.transport })) : config.value.skillLibraries.map((item, index) => ({ index, title: item.id, detail: item.directory, badge: 'Skills' }));
  }
});
const filteredEntries = computed(() => entries.value.filter(item => `${item.title} ${item.detail}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
const selectedEntry = computed(() => entries.value[selectedIndex.value]);
const connection = computed(() => config.value.connections[selectedIndex.value]);
const library = computed(() => props.section === 'memoryLibraries' ? config.value.memoryLibraries[selectedIndex.value] : config.value.knowledgeLibraries[selectedIndex.value]);
const server = computed(() => config.value.mcpServers[selectedIndex.value]);
const skill = computed(() => config.value.skillLibraries[selectedIndex.value]);
const environment = computed(() => config.value.executionEnvironments[selectedIndex.value]);
const connectedAgents = computed(() => config.value.agents.filter(agent => agent.connectionId === connection.value?.id));
watch([() => props.section, extension], () => { selectedIndex.value = 0; search.value = ''; });
watch(() => entries.value.length, length => { selectedIndex.value = Math.min(selectedIndex.value, Math.max(0, length - 1)); });
function addResource() {
  const suffix = randomId().slice(0, 6); search.value = '';
  switch (props.section) {
    case 'connections': config.value.connections.push(ConnectionSchema.parse({ id: `connection-${suffix}` })); break;
    case 'memoryLibraries': case 'knowledgeLibraries': config.value[props.section].push({ id: `library-${suffix}`, displayName: `新${titles[props.section]}` }); break;
    case 'environments': config.value.executionEnvironments.push(ExecutionEnvironmentSchema.parse({ id: `environment-${suffix}`, type: 'local', root: './workspace' })); break;
    case 'extensions': if (extension.value === 'mcp') config.value.mcpServers.push(McpServerConfigSchema.parse({ id: `mcp-${suffix}`, transport: 'stdio' })); else config.value.skillLibraries.push({ id: `skill-${suffix}`, directory: './skills' }); break;
  }
  selectedIndex.value = entries.value.length - 1;
}
function removeResource() {
  if(!selectedEntry.value || !confirmDestructiveAction(`从草稿移除“${selectedEntry.value.title}”？发布运行配置后生效。请同时检查 Agent、授权及路由中的关联引用。`))return;
  const index = selectedIndex.value;
  switch (props.section) {
    case 'connections': config.value.connections.splice(index, 1); break;
    case 'memoryLibraries': case 'knowledgeLibraries': config.value[props.section].splice(index, 1); break;
    case 'environments': config.value.executionEnvironments.splice(index, 1); break;
    case 'extensions': if (extension.value === 'mcp') config.value.mcpServers.splice(index, 1); else config.value.skillLibraries.splice(index, 1); break;
  }
  selectedIndex.value = Math.min(index, Math.max(0, entries.value.length - 1));
}
function setBaseUrl(event: Event) { if (!connection.value || !(event.target instanceof HTMLInputElement)) return; if (event.target.value.trim()) connection.value.baseUrl = event.target.value.trim(); else delete connection.value.baseUrl; }
function setMcpArgs(event: Event) { if (server.value && event.target instanceof HTMLTextAreaElement) server.value.args = event.target.value.split('\n').filter(Boolean); }
function setMcpRefs(field: 'envRefs' | 'headersEnv', event: Event) {
  if (!server.value || !(event.target instanceof HTMLTextAreaElement)) return;
  const values: Record<string, string> = {};
  for (const line of event.target.value.split('\n')) { const equals = line.indexOf('='); if (equals > 0) values[line.slice(0, equals).trim()] = line.slice(equals + 1).trim(); }
  server.value[field] = values;
}
function refsText(values: Record<string, string>) { return Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n'); }
function toggleEmbedding(event: Event) { if (!(event.target instanceof HTMLInputElement)) return; if (event.target.checked) config.value.embedding = { connectionId: config.value.connections[0]?.id ?? 'default', model: 'text-embedding-3-small', dimensions: 1536 }; else delete config.value.embedding; }
function toggleReranker(event: Event) { if (!(event.target instanceof HTMLInputElement)) return; if (event.target.checked) config.value.reranker = { url: 'http://127.0.0.1:8000/rerank', apiKeyEnv: 'RERANK_API_KEY', model: 'reranker' }; else delete config.value.reranker; }
</script>
<template>
  <div class="resource-page">
    <div v-if="section === 'extensions'" class="resource-tabs" aria-label="扩展类型">
      <button :class="{ active: extension === 'mcp' }" :aria-pressed="extension === 'mcp'" @click="extension = 'mcp'">MCP 服务 <span>{{ config.mcpServers.length }}</span></button>
      <button :class="{ active: extension === 'skills' }" :aria-pressed="extension === 'skills'" @click="extension = 'skills'">Skills <span>{{ config.skillLibraries.length }}</span></button>
    </div>
    <div class="resource-workbench">
      <aside class="resource-sidebar">
        <div class="resource-sidebar-head"><strong>{{ itemLabel }}</strong><span>{{ entries.length }}</span></div>
        <input v-model="search" type="search" :aria-label="`搜索${itemLabel}`" :placeholder="`搜索${itemLabel}…`">
        <div class="resource-list" :aria-label="`${itemLabel}列表`">
          <button v-for="entry in filteredEntries" :key="entry.index" class="resource-item" :class="{ selected: entry.index === selectedIndex }" :aria-pressed="entry.index === selectedIndex" @click="selectedIndex = entry.index"><strong>{{ entry.title }}</strong><small>{{ entry.detail }}</small><span class="resource-badge">{{ entry.badge }}</span></button>
          <p v-if="!filteredEntries.length" class="resource-list-empty">{{ entries.length ? '没有匹配的结果' : `尚未添加${itemLabel}` }}</p>
        </div>
        <button class="resource-add" @click="addResource">＋ 添加{{ itemLabel }}</button>
      </aside>
      <section class="resource-editor">
        <template v-if="selectedEntry">
          <header class="resource-editor-head"><div><h2>{{ selectedEntry.title }}</h2><p>{{ selectedEntry.detail }}</p></div><span class="chip">{{ selectedEntry.badge }}</span></header>
          <div class="resource-settings ts-fields">
            <template v-if="section === 'connections' && connection">
              <h3>基本设置</h3><div class="ts-form-grid">
                <label>连接 ID<input v-model="connection.id" aria-describedby="resource-connection-id-help"><small id="resource-connection-id-help" aria-hidden="true">Agent 用此 ID 引用服务。修改后，请更新相关 Agent 的连接设置。</small></label><label>接口协议<select v-model="connection.protocol" aria-describedby="resource-protocol-help"><option value="responses">Responses</option><option value="chat_completions">Chat Completions</option></select><small id="resource-protocol-help" aria-hidden="true">选择服务实际支持的 API 协议。</small></label>
                <label class="ts-wide">API 地址<input :value="connection.baseUrl" @change="setBaseUrl" type="url" placeholder="留空使用 OpenAI 默认地址" aria-describedby="resource-api-help"><small id="resource-api-help" aria-hidden="true">填写服务的 API 基础地址。需要时保留 /v1 等路径。</small></label>
                <label class="ts-wide">API 密钥环境变量名<input v-model="connection.apiKeyEnv" autocomplete="off" aria-describedby="resource-key-help"><small id="resource-key-help" aria-hidden="true">填写密钥名称，例如 OPENAI_API_KEY。请在系统设置保存同名密钥，或在服务端设置同名环境变量。</small></label>
              </div>
              <section class="resource-models"><h3>使用此服务的 Agent</h3><p v-if="!connectedAgents.length">当前草稿中没有 Agent 使用此服务。请到 Agent 设置选择连接和模型。</p><div v-for="agent in connectedAgents" :key="agent.id" class="resource-model-row"><strong>{{ agent.id }}</strong><span>{{ agent.model }}</span></div></section>
            </template>
            <template v-else-if="(section === 'memoryLibraries' || section === 'knowledgeLibraries') && library"><h3>资源库设置</h3><div class="ts-form-grid"><label>库 ID<input v-model="library.id" aria-describedby="resource-library-id-help"><small id="resource-library-id-help" aria-hidden="true">Agent 和资料记录用此 ID 识别库。修改 ID 不会搬迁已有内容。</small></label><label>显示名称<input v-model="library.displayName" aria-describedby="resource-library-name-help"><small id="resource-library-name-help" aria-hidden="true">填写便于识别的名称。修改名称不会改变库 ID。</small></label></div><p class="resource-hint">先发布运行配置。再到 Agent 装配此库，并配置发送者的访问权限。</p></template>
            <template v-else-if="section === 'extensions' && extension === 'mcp' && server">
              <h3>服务设置</h3><div class="ts-form-grid"><label>MCP ID<input v-model="server.id" aria-describedby="resource-mcp-id-help"><small id="resource-mcp-id-help" aria-hidden="true">Agent 用此 ID 选择 MCP 服务。</small></label><label>连接方式<select v-model="server.transport" aria-describedby="resource-mcp-transport-help"><option value="stdio">标准输入输出（stdio）</option><option value="streamable_http">Streamable HTTP</option><option value="sse">SSE</option></select><small id="resource-mcp-transport-help" aria-hidden="true">stdio 启动服务端本机进程。HTTP 和 SSE 连接指定服务地址。</small></label>
                <template v-if="server.transport === 'stdio'"><label class="ts-wide">启动命令<input v-model="server.command" aria-describedby="resource-mcp-command-help"><small id="resource-mcp-command-help" aria-hidden="true">填写运行服务所在主机可执行的命令。参数在下方单独填写。</small></label><label class="ts-wide">启动参数（每行一个）<textarea :value="server.args.join('\n')" rows="3" @change="setMcpArgs" aria-describedby="resource-mcp-args-help"></textarea><small id="resource-mcp-args-help" aria-hidden="true">每行填一个参数。系统按行传给启动命令。</small></label><label class="ts-wide">环境变量引用（变量名=服务端环境变量名）<textarea :value="refsText(server.envRefs)" rows="3" @change="setMcpRefs('envRefs', $event)" aria-describedby="resource-mcp-env-help"></textarea><small id="resource-mcp-env-help" aria-hidden="true">每行填写一个映射，例如 API_KEY=MCP_API_KEY。右侧填系统密钥名称或服务端环境变量名。</small></label></template>
                <template v-else><label class="ts-wide">MCP 地址<input v-model="server.url" type="url" aria-describedby="resource-mcp-url-help"><small id="resource-mcp-url-help" aria-hidden="true">填写所选连接方式对应的完整端点地址。</small></label><label class="ts-wide">请求头引用（请求头=服务端环境变量名）<textarea :value="refsText(server.headersEnv)" rows="3" @change="setMcpRefs('headersEnv', $event)" aria-describedby="resource-mcp-headers-help"></textarea><small id="resource-mcp-headers-help" aria-hidden="true">每行填写一个映射，例如 Authorization=MCP_AUTH。密钥值会原样作为请求头发送。</small></label></template>
              </div>
              <details class="resource-hint"><summary>MCP 凭据与工具授权</summary><p>先在系统设置保存映射右侧的密钥。若服务要求 Bearer 认证，请在密钥值中包含 Bearer 前缀。</p><p>保存配置后，请为 Agent 装配 MCP 服务和具体工具名。实际运行时才连接服务并发现工具。</p></details>
            </template>
            <template v-else-if="section === 'extensions' && extension === 'skills' && skill"><h3>Skills 设置</h3><div class="ts-form-grid"><label>资源库 ID<input v-model="skill.id" aria-describedby="resource-skill-id-help"><small id="resource-skill-id-help" aria-hidden="true">Agent 用此 ID 引用技能库。</small></label><label>Skill 目录<input v-model="skill.directory" aria-describedby="resource-skill-directory-help"><small id="resource-skill-directory-help" aria-hidden="true">填写运行服务所在主机的技能根目录。每个技能放在独立子目录中，并包含 SKILL.md。</small></label></div><p class="resource-hint">保存配置后，请为 Agent 装配技能库和 read_skill 工具。人格可以进一步限制可读取的技能。</p></template>
            <template v-else-if="section === 'environments' && environment">
              <h3>环境设置</h3>
              <div class="ts-form-grid">
                <label>环境 ID<input v-model="environment.id" aria-describedby="resource-environment-id-help"><small id="resource-environment-id-help" aria-hidden="true">Agent 和发送者授权用此 ID 选择执行环境。</small></label>
                <label>执行后端<select v-model="environment.type" aria-describedby="resource-backend-help"><option value="local">本机进程</option><option value="docker">Docker 容器</option><option value="sdk_docker">SDK Docker</option></select><small id="resource-backend-help" aria-hidden="true">选择命令运行的位置和隔离方式。</small></label>
                <label class="ts-wide">工作根目录<input v-model="environment.root" aria-describedby="resource-root-help"><small id="resource-root-help" aria-hidden="true">填写运行服务所在主机的工作文件目录。<template v-if="environment.type === 'sdk_docker'">关闭容器后，工作文件仍会保留。</template></small></label>
                <label v-if="environment.type !== 'local'" class="ts-wide">容器镜像<input v-model.trim="environment.image" :placeholder="environment.type === 'sdk_docker' ? 'python:3.14-slim（默认）' : 'alpine:3.21（默认）'" aria-describedby="resource-image-help"><small id="resource-image-help" aria-hidden="true">留空使用默认镜像。请在镜像中预装任务需要的命令。<template v-if="environment.type === 'sdk_docker'">SDK Docker 还需要 /bin/sh、GNU 工具和 Python。</template></small></label>
                <label v-if="environment.type === 'sdk_docker'" class="ts-check ts-wide"><input v-model="environment.networkEnabled" type="checkbox">允许容器访问网络</label>
              </div>
              <template v-if="environment.type === 'sdk_docker'"><p class="resource-hint">打开网络开关后，容器使用 Docker 默认网络。关闭开关会禁用容器网络。</p><details class="resource-hint"><summary>容器隔离与资源上限</summary><p>容器按会话和用户隔离。每个容器最多使用 512 MiB 内存、1 个 CPU 和 64 个进程。</p></details></template>
              <p v-else-if="environment.type === 'docker'" class="resource-hint">此后端禁用网络。容器根目录只读。需要联网下载时，请选择 SDK Docker 并打开网络开关。</p>
              <p v-else class="resource-hint">命令直接在运行服务所在主机执行。网络访问由主机决定。</p>
            </template>
          </div>
          <footer class="resource-editor-footer"><small>修改先加入草稿。请发布运行配置后再使用。</small><button class="danger" @click="removeResource">移除{{ itemLabel }}</button></footer>
        </template>
        <div v-else class="resource-empty"><span>＋</span><h3>添加你的第一个{{ itemLabel }}</h3><p>从左侧添加，然后在这里完成设置。</p><button @click="addResource">添加{{ itemLabel }}</button></div>
      </section>
    </div>
    <section v-if="section === 'knowledgeLibraries'" class="resource-retrieval">
      <h3>检索模型</h3><p>这些设置用于所有知识库。Embedding 生成检索向量。Reranker 对检索结果重新排序。</p><div class="ts-fields">
        <label class="ts-check"><input type="checkbox" :checked="!!config.embedding" @change="toggleEmbedding">使用 Embedding 模型</label>
        <div v-if="config.embedding" class="ts-form-grid"><label>Embedding 连接<select v-model="config.embedding.connectionId" aria-describedby="resource-embedding-connection-help"><option v-for="item in config.connections" :key="item.id" :value="item.id">{{ item.id }}</option></select><small id="resource-embedding-connection-help" aria-hidden="true">选择支持 /embeddings 接口的模型服务。</small></label><label>Embedding 模型<input v-model="config.embedding.model" aria-describedby="resource-embedding-model-help"><small id="resource-embedding-model-help" aria-hidden="true">填写服务支持的向量模型名称。</small></label><label>向量维度<input v-model.number="config.embedding.dimensions" type="number" min="1" aria-describedby="resource-dimensions-help"><small id="resource-dimensions-help" aria-hidden="true">此值必须与模型返回的向量长度一致。</small></label></div>
        <label class="ts-check"><input type="checkbox" :checked="!!config.reranker" @change="toggleReranker">启用 Reranker</label>
        <div v-if="config.reranker" class="ts-form-grid"><label>Reranker API 地址<input v-model="config.reranker.url" type="url" aria-describedby="resource-reranker-url-help"><small id="resource-reranker-url-help" aria-hidden="true">填写完整重排端点，例如 https://example.com/rerank。</small></label><label>密钥环境变量名<input v-model="config.reranker.apiKeyEnv" aria-describedby="resource-reranker-key-help"><small id="resource-reranker-key-help" aria-hidden="true">填写已保存的密钥名称或服务端环境变量名。</small></label><label>Reranker 模型<input v-model="config.reranker.model" aria-describedby="resource-reranker-model-help"><small id="resource-reranker-model-help" aria-hidden="true">填写重排服务支持的模型名称。</small></label></div>
      </div>
    </section>
  </div>
</template>
<style scoped>
.resource-page{display:grid;gap:20px;min-width:0}.resource-tabs{display:flex;gap:8px}.resource-tabs button{border-color:transparent;background:transparent}.resource-tabs button.active{background:var(--accent-soft);color:var(--accent-ink)}.resource-tabs span{margin-left:8px;color:var(--muted)}.resource-workbench{display:grid;grid-template-columns:minmax(220px,280px) minmax(0,1fr);border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--surface);min-height:460px}.resource-sidebar{padding:20px 16px;display:flex;flex-direction:column;gap:16px;border-right:1px solid var(--line);min-width:0}.resource-sidebar-head{display:flex;justify-content:space-between;align-items:center;font-size:14px}.resource-sidebar-head span{font-size:12px;color:var(--muted)}.resource-sidebar>input{width:100%;font-size:13px}.resource-list{display:grid;gap:8px;align-content:start;flex:1;max-height:540px;overflow:auto}.resource-item{display:grid;gap:5px;text-align:left;justify-content:stretch;min-width:0;background:transparent;border:1px solid transparent;padding:12px}.resource-item.selected{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-ink)}.resource-item strong{font-size:14px;overflow-wrap:anywhere}.resource-item small{font-weight:400;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.resource-badge{font-size:10px;justify-self:start;font-weight:500;opacity:.8}.resource-list-empty{font-size:13px;color:var(--muted);text-align:center;padding:20px 0}.resource-add{width:100%;border-style:dashed;color:var(--accent-ink)}.resource-editor{min-width:0;display:flex;flex-direction:column}.resource-editor-head{display:flex;justify-content:space-between;align-items:start;gap:16px;padding:24px;border-bottom:1px solid var(--line)}.resource-editor-head h2{font-size:21px;overflow-wrap:anywhere}.resource-editor-head p{font-size:12px;color:var(--muted);margin:6px 0 0;overflow-wrap:anywhere}.resource-editor-head .chip{white-space:nowrap}.resource-settings{padding:24px;flex:1}.resource-settings h3,.resource-retrieval h3{font-size:15px;margin:0}.resource-settings label{font-size:13px}.resource-settings small,.resource-hint{font-size:12px;color:var(--muted);line-height:1.7}.resource-models{border-top:1px solid var(--line);padding-top:24px;margin-top:10px}.resource-models p{font-size:13px;color:var(--muted);margin-top:12px;line-height:1.7}.resource-model-row{display:flex;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid var(--line);font-size:13px;overflow-wrap:anywhere}.resource-model-row span{color:var(--muted)}.resource-editor-footer{border-top:1px solid var(--line);padding:18px 24px;display:flex;justify-content:space-between;align-items:center;gap:16px}.resource-editor-footer small{color:var(--muted);font-size:12px}.resource-empty{display:grid;align-content:center;justify-items:center;text-align:center;gap:16px;min-height:380px;padding:32px;color:var(--muted)}.resource-empty>span{font-size:38px;color:var(--accent)}.resource-empty h3{font-size:17px;color:var(--ink)}.resource-empty p{font-size:13px}.resource-retrieval{padding:24px;border:1px solid var(--line);border-radius:16px;background:var(--surface)}.resource-retrieval>p{font-size:13px;color:var(--muted);margin:8px 0 20px}@media(max-width:960px){.resource-workbench{grid-template-columns:220px minmax(0,1fr)}.resource-settings .ts-form-grid{grid-template-columns:1fr}}@media(max-width:720px){.resource-workbench{grid-template-columns:1fr}.resource-sidebar{border-right:0;border-bottom:1px solid var(--line)}.resource-list{max-height:230px}.resource-editor-head,.resource-settings,.resource-retrieval{padding:18px}.resource-editor-footer{padding:18px;flex-wrap:wrap}.resource-editor-head{flex-wrap:wrap}.resource-model-row{flex-wrap:wrap}}
</style>
