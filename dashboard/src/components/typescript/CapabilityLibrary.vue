<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { PhMagnifyingGlass, PhArrowClockwise, PhArrowUpRight } from '@phosphor-icons/vue';
import { AgentCapabilitiesSchema, type AgentCapability } from '../../../../packages/contracts/src/agent-workbench';
import { requiredRuntimeState, runtimeStateLabels } from '../../../../packages/contracts/src/index';
import { runtimeRequest } from '../../api/typescript';
import CommandPolicyDetails from './CommandPolicyDetails.vue';
import { commandToolNotice } from './command-policy-model';

const route = useRoute(); const router = useRouter();
const commandPolicyHelp = ref<HTMLDetailsElement>();
function openCommandPolicy(): void { const section=commandPolicyHelp.value;if(!section)return;section.open=true;void nextTick(()=>section.scrollIntoView({block:'start'})); }
type Filter = 'all' | 'general' | 'napcat' | 'telegram' | 'weixin';
const options: readonly { id: Filter; label: string }[] = [{ id:'all', label:'全部' }, { id:'general', label:'通用能力' }, { id:'napcat', label:'QQ / NapCat' }, { id:'telegram', label:'Telegram' }, { id:'weixin', label:'微信' }];
const sourceLabels: Readonly<Record<AgentCapability['source'], string>> = { builtin:'内置', search:'网络搜索', plugin:'插件', mcp:'MCP', skills:'Skills', native_extension:'原生扩展', platform:'平台提供' };
const availabilityLabels: Readonly<Record<AgentCapability['availability'], string>> = { registered:'已登记', disabled:'来源已停用', runtime_discovery:'运行时发现', not_implemented:'暂未提供' };
const entries = ref<AgentCapability[]>([]); const loading = ref(false); const error = ref(''); const query = ref(''); const filter = ref<Filter>('all');
function syncFilter(): void { const value = route.query.platform; filter.value = options.find(option => option.id === value)?.id ?? 'all'; }
syncFilter(); watch(() => route.query.platform, syncFilter);
async function selectFilter(value: Filter): Promise<void> { await router.replace({ query: { ...route.query, platform: value === 'all' ? undefined : value } }); }
async function refresh(): Promise<void> { loading.value = true; error.value = ''; try { entries.value = (await runtimeRequest('agent-capabilities', AgentCapabilitiesSchema)).entries; } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); } finally { loading.value = false; } }
onMounted(() => { void refresh(); });
const visible = computed(() => entries.value.filter(entry => {
  const matchesScope = filter.value === 'all' || (filter.value === 'general' ? entry.scope === 'general' : entry.scope === 'platform' && entry.platforms.includes(filter.value));
  const text = `${entry.label} ${entry.id} ${entry.description} ${entry.sourceId} ${sourceLabels[entry.source]}`.toLocaleLowerCase();
  return matchesScope && query.value.trim().toLocaleLowerCase().split(/\s+/).every(term => text.includes(term));
}));
const groups = computed(() => [
  { id:'general', label:'通用能力', description:'可跨平台使用；群聊、资源与权限条件仍需满足。', items:visible.value.filter(entry => entry.scope === 'general') },
  { id:'platform', label:'平台专属能力', description:'由对应机器人平台提供，只在匹配的平台与会话中注入。', items:visible.value.filter(entry => entry.scope === 'platform') },
].filter(group => group.items.length));
function platformText(entry: AgentCapability): string { return entry.platforms.map(platform => platform === 'napcat' ? 'QQ / NapCat' : platform === 'telegram' ? 'Telegram' : '微信').join('、'); }
</script>
<template>
  <section class="capability-library">
    <header class="section-title"><div><h2>能力目录</h2><p>先了解能力来自哪里，再到 Agent 装配。已登记不代表当前会话已获授权。</p></div><button type="button" :disabled="loading" @click="refresh"><PhArrowClockwise :size="16"/>刷新目录</button></header>
    <p v-if="error" role="alert" class="notice error">{{error}}</p>
    <div class="capability-filters"><label><PhMagnifyingGlass :size="17" aria-hidden="true"/><input v-model="query" type="search" aria-label="搜索能力" placeholder="搜索群文件、历史记录、MCP…"></label><nav aria-label="能力适用范围"><button v-for="option in options" :key="option.id" type="button" :aria-pressed="filter===option.id" @click="selectFilter(option.id)">{{option.label}}</button></nav></div>
    <details ref="commandPolicyHelp" class="command-policy-entry"><summary>查看命令执行范围与参数</summary><CommandPolicyDetails/></details>
    <p v-if="loading" role="status" class="empty-state">正在读取服务端能力目录…</p>
    <p v-else-if="!visible.length" class="empty-state">没有匹配能力。可以清空搜索或切换适用范围。</p>
    <section v-for="group in groups" :key="group.id" class="capability-group">
      <header><h3>{{group.label}} <small>{{group.items.length}}</small></h3><p>{{group.description}}</p></header>
      <article v-for="entry in group.items" :key="entry.id" class="capability-row">
        <div class="capability-description"><strong>{{entry.label}}</strong><p>{{entry.description}}</p><p v-if="entry.source==='builtin' && commandToolNotice(entry.toolName)" class="command-scope-note">{{commandToolNotice(entry.toolName)}} <button type="button" @click="openCommandPolicy">查看命令范围</button></p><div class="capability-tags"><span>{{sourceLabels[entry.source]}}</span><span v-if="entry.kind!=='tool'">{{entry.kind==='command'?'指令':entry.kind==='platform_status'?'平台说明':entry.bindingName?'自动处理权限':'资源'}}</span><span v-if="entry.scope==='platform'||entry.platforms.length<3">{{platformText(entry)}}</span><span v-if="entry.sessionTypes.length===1">{{entry.sessionTypes[0]==='group'?'仅群聊':'仅私聊'}}</span><span :class="{'capability-unavailable':entry.availability==='disabled'||entry.availability==='not_implemented'}">{{availabilityLabels[entry.availability]}}</span></div><details v-if="entry.requirements.length||entry.requiredCapabilities.length"><summary>生效条件</summary><ul><li v-for="requirement in entry.requirements" :key="requirement">{{requirement}}</li><li v-if="entry.requiredCapabilities.length">最低运行态：{{runtimeStateLabels[requiredRuntimeState(entry.requiredCapabilities)]}}</li></ul><code v-if="entry.toolName">{{entry.toolName}}</code></details></div>
        <RouterLink v-if="entry.settingsPath" class="button-link" :to="entry.settingsPath">配置来源<PhArrowUpRight :size="14"/></RouterLink>
      </article>
    </section>
    <footer><p class="muted">平台能收发消息，不等于提供了专属模型工具。未提供的能力会明确标记；MCP 工具以连接后的实际发现结果为准。</p><RouterLink class="button-link primary" to="/agents?section=tools">去 Agent 装配能力</RouterLink></footer>
  </section>
</template>
<style scoped>
.capability-library{display:grid;gap:24px}.command-policy-entry>summary{font-size:13px;color:var(--accent-ink);cursor:pointer}.command-policy-entry[open]>summary{margin-bottom:20px}.capability-description .command-scope-note{color:var(--ink);font-size:12px;line-height:1.8}.command-scope-note button{border:0;background:transparent;color:var(--accent-ink);font-size:12px;min-height:0;padding:0 4px;text-decoration:underline}.capability-filters{display:grid;gap:16px}.capability-filters>label{display:flex;align-items:center;gap:9px;border:1px solid var(--line-strong);padding:0 12px;border-radius:7px;max-width:490px;background:var(--surface)}.capability-filters input{border:0;flex:1;min-width:0}.capability-filters nav{display:flex;gap:8px;flex-wrap:wrap}.capability-filters nav button{border-color:transparent;background:transparent}.capability-filters nav button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent-ink);border-color:var(--line-strong)}.capability-group>header{padding:0 0 12px;border-bottom:1px solid var(--line)}.capability-group h3{margin:0 0 5px;font-size:17px}.capability-group h3 small{font-weight:400;color:var(--muted);margin-left:7px}.capability-group>header p{font-size:13px;color:var(--muted)}.capability-row{display:flex;gap:18px;align-items:flex-start;padding:19px 0;border-bottom:1px solid var(--line)}.capability-description{flex:1;min-width:0}.capability-description>p{font-size:13px;color:var(--muted);margin:5px 0 9px;overflow-wrap:anywhere}.capability-tags{display:flex;gap:8px 15px;flex-wrap:wrap;color:var(--muted);font-size:12px}.capability-unavailable{color:var(--warning)}.capability-description details{margin-top:10px;font-size:12px}.capability-description summary{font-size:12px}.capability-description ul{margin:8px 0;padding-left:18px}.capability-description code{overflow-wrap:anywhere}.capability-library footer{display:flex;justify-content:space-between;align-items:center;gap:20px}.capability-library footer p{max-width:720px}@media(max-width:650px){.capability-row{flex-direction:column;gap:12px}.capability-library footer{display:grid}.capability-filters nav button{padding:7px 9px;font-size:12px}}
</style>
