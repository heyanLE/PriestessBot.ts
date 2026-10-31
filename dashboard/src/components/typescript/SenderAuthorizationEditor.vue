<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { PhPlus, PhTrash, PhUsers } from '@phosphor-icons/vue';
import { RuntimeStateSchema, runtimeStateLabels, type Grant, type RuntimeConfig } from '../../../../packages/contracts/src/index';
import { confirmDestructiveAction } from '../../composables/unsaved';
import { randomId } from '../../utils/random-id';
import RuntimeStatePermissions from './RuntimeStatePermissions.vue';
import { parseSenderIds, senderAuthorizationConflicts, senderScopeLabel } from './sender-authorization';

const config = defineModel<RuntimeConfig>({ required: true });
const route = useRoute(); const router = useRouter();
const platformFilter = ref('');
interface SenderInput { readonly key: string; text: string; }
let inputs = new WeakMap<Grant, SenderInput>();
function inputFor(grant: Grant): SenderInput { const stored = inputs.get(grant); if (stored) return stored; const value = { key:randomId(), text:grant.senderIds.join('\n') }; inputs.set(grant, value); return value; }
watch(() => config.value.grants, () => { inputs = new WeakMap(); });
function applyFilter(): void { platformFilter.value = typeof route.query.platform === 'string' ? route.query.platform : ''; }
applyFilter(); watch(() => route.query.platform, applyFilter);
async function setFilter(event: Event): Promise<void> { if (!(event.target instanceof HTMLSelectElement)) return; await router.replace({ query: { ...route.query, platform:event.target.value || undefined } }); }
const rows = computed(() => config.value.grants.map((grant,index) => ({ grant,index })).filter(row => !platformFilter.value || row.grant.platform === platformFilter.value));
const conflicts = computed(() => senderAuthorizationConflicts(config.value.grants));
const knownPlatforms = computed(() => new Set(config.value.platforms.map(platform => platform.id)));
const retainedPlatforms = computed(() => [...new Set(config.value.grants.map(grant => grant.platform))].filter(id => !knownPlatforms.value.has(id)));
function platformName(id: string): string { return config.value.platforms.find(item => item.id === id)?.displayName || (id === 'dashboard' ? '控制台对话' : id); }
function addGrant(): void {
  const platform = platformFilter.value || config.value.platforms[0]?.id || 'dashboard'; config.value.grants.push({ platform, senderIds:[], state:'operator' });
  const grant = config.value.grants.at(-1); if (!grant) return;
  const id = `${inputFor(grant).key}-ids`; void nextTick(() => { const field = document.getElementById(id); if (field instanceof HTMLTextAreaElement) field.focus(); });
}
function updateIds(grant: Grant, event: Event): void { if (!(event.target instanceof HTMLTextAreaElement)) return; inputFor(grant).text = event.target.value; grant.senderIds = parseSenderIds(event.target.value); }
function remove(index: number): void {
  const grant = config.value.grants[index]; if (!grant) return;
  if (!confirmDestructiveAction(`从草稿移除这条授权？发布后，这 ${grant.senderIds.length} 个 ID 会使用其他匹配授权。没有其他授权时，使用普通干员态。`)) return;
  config.value.grants.splice(index,1);
}
</script>
<template>
  <section class="sender-authorization" aria-label="发送者运行态授权">
    <header class="authorization-heading"><div><h2>发送者授权</h2><p>选择机器人，填写发送者 ID，再分配一个运行态。同一条授权中的所有 ID 使用同一个态。</p></div><button type="button" class="primary" @click="addGrant"><PhPlus :size="17"/>添加授权</button></header>
    <div class="authorization-filter"><label for="sender-platform-filter">查看机器人</label><select id="sender-platform-filter" :value="platformFilter" @change="setFilter"><option value="">全部机器人</option><option v-for="platform in config.platforms" :key="platform.id" :value="platform.id">{{platform.displayName || platform.id}}</option><option v-for="id in retainedPlatforms" :key="id" :value="id">{{platformName(id)}}{{id==='dashboard'?'':'（未登记实例）'}}</option></select><RouterLink to="/platforms">管理机器人</RouterLink></div>
    <div v-if="conflicts.length" class="notice error" role="alert"><strong>同一发送者被分配了不同运行态。</strong><p v-for="conflict in conflicts" :key="`${conflict.firstIndex}:${conflict.secondIndex}:${conflict.senderId}`">{{platformName(conflict.platform)}}：ID {{conflict.senderId}} 同时出现在授权 {{conflict.firstIndex+1}} 和 {{conflict.secondIndex+1}}。请保留一个态，或从其中一条移除此 ID。</p></div>
    <p v-if="!rows.length" class="empty-state">{{platformFilter?'此机器人还没有发送者授权。':'还没有发送者授权。'}}点击“添加授权”开始配置。</p>
    <article v-for="row in rows" :key="inputFor(row.grant).key" class="authorization-rule">
      <header><h3><PhUsers :size="19"/>授权 {{row.index+1}} <small>{{row.grant.senderIds.length}} 个发送者</small></h3><button type="button" class="remove-authorization" @click="remove(row.index)"><PhTrash :size="16"/>移除授权</button></header>
      <div class="authorization-fields"><label :for="`${inputFor(row.grant).key}-platform`">机器人<select :id="`${inputFor(row.grant).key}-platform`" v-model="row.grant.platform"><option v-if="!knownPlatforms.has(row.grant.platform)" :value="row.grant.platform">{{platformName(row.grant.platform)}}{{row.grant.platform==='dashboard'?'':'（未登记实例）'}}</option><option v-for="platform in config.platforms" :key="platform.id" :value="platform.id">{{platform.displayName || platform.id}}</option></select></label><label :for="`${inputFor(row.grant).key}-state`">分配运行态<select :id="`${inputFor(row.grant).key}-state`" v-model="row.grant.state"><option v-for="state in RuntimeStateSchema.options" :key="state" :value="state">{{runtimeStateLabels[state]}}</option></select></label></div>
      <div class="sender-id-field"><label :for="`${inputFor(row.grant).key}-ids`">发送者 ID</label><textarea :id="`${inputFor(row.grant).key}-ids`" :value="inputFor(row.grant).text" :aria-describedby="`${inputFor(row.grant).key}-help`" rows="3" maxlength="60000" placeholder="123456789&#10;987654321" @input="updateIds(row.grant,$event)"/><p :id="`${inputFor(row.grant).key}-help`">每行填写一个 ID，也可用逗号或空格分隔。重复 ID 只计算一次。最多 200 个。ID 按完整字符串匹配，不会把 001 当成 1。</p><p v-if="!row.grant.senderIds.length" class="field-warning">至少填写一个发送者 ID，才能发布。</p><p v-else-if="row.grant.senderIds.length>200" class="field-error">已填写 {{row.grant.senderIds.length}} 个 ID。请减少到 200 个以内。</p><p v-else-if="row.grant.senderIds.some(id=>id.length>256)" class="field-error">有 ID 超过 256 个字符。请检查是否误粘贴了消息正文。</p></div>
      <footer><span>生效范围：{{senderScopeLabel(row.grant)}}</span><p v-if="row.grant.sessionId || row.grant.sessionType">此条保留原有会话范围。修改 ID 或运行态不会扩大范围。</p><p>修改先加入配置草稿。点击页面顶部的“发布运行配置”后生效。</p></footer>
    </article>
    <details class="fixed-state-help"><summary>查看三个运行态的固定权限</summary><RuntimeStatePermissions/></details>
  </section>
</template>
<style scoped>
.sender-authorization{display:grid;gap:24px}.authorization-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:22px}.authorization-heading h2{font-size:22px;margin:0 0 8px}.authorization-heading p{font-size:13px;color:var(--muted);line-height:1.8;max-width:720px;margin:0}.authorization-heading>button{white-space:nowrap;flex-shrink:0}.authorization-filter{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.authorization-filter>label{font-size:13px;color:var(--muted)}.authorization-filter select{min-width:190px;max-width:320px}.authorization-filter>a{font-size:13px;margin-left:auto}.authorization-rule{padding:22px 0;border-top:1px solid var(--line);display:grid;gap:20px;min-width:0}.authorization-rule>header{display:flex;justify-content:space-between;align-items:center;gap:15px}.authorization-rule h3{display:flex;align-items:center;gap:9px;font-size:16px;margin:0}.authorization-rule h3 small{font-size:12px;color:var(--muted);font-weight:400}.authorization-rule .remove-authorization{background:transparent;border:0;font-size:12px;color:var(--critical)}.authorization-fields{display:grid;grid-template-columns:1fr 1fr;gap:20px}.authorization-fields label,.sender-id-field{display:grid;gap:8px;font-size:13px}.authorization-fields select,.sender-id-field textarea{width:100%;min-width:0;font-size:14px}.sender-id-field textarea{line-height:1.8;resize:vertical}.sender-id-field p,.authorization-rule footer{font-size:12px;line-height:1.8;color:var(--muted);margin:0}.sender-id-field .field-warning{color:var(--warning)}.sender-id-field .field-error{color:var(--critical)}.authorization-rule footer{display:grid;gap:4px}.authorization-rule footer>span{color:var(--ink)}.authorization-rule footer p{margin:0}.notice.error p{margin:8px 0 0;font-size:13px}.fixed-state-help{border-top:1px solid var(--line);padding-top:20px}.fixed-state-help>summary{font-size:13px;color:var(--accent-ink);cursor:pointer;margin-bottom:18px}@media(max-width:700px){.authorization-heading{flex-direction:column;gap:15px}.authorization-fields{grid-template-columns:1fr;gap:16px}.authorization-filter>a{margin-left:0}.authorization-filter select{flex:1;min-width:150px}.authorization-rule{padding-top:19px}.authorization-rule h3{flex-wrap:wrap}.authorization-rule>header{align-items:flex-start}.authorization-rule .remove-authorization{white-space:nowrap}}
</style>
