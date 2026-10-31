<script setup lang="ts">
import { confirmDestructiveAction } from '../../composables/unsaved';
import { onMounted, ref, watch } from 'vue';
import { PluginSubscriptionsSchema, PluginMutationOkSchema, type PluginSubscriptions } from '../../../../typescript/packages/contracts/src/plugins';
import { runtimeRequest } from '../../api/typescript';
const props = defineProps<{ id: 'bili_video' | 'bangumi' }>();
const entries = ref<PluginSubscriptions['subscriptions']>([]);
const busy = ref(false); const error = ref(''); const notice = ref('');
let generation = 0;
async function load(): Promise<void> { const current = ++generation; busy.value = true; error.value = ''; try { const result = await runtimeRequest(`plugins/${props.id}/subscriptions`, PluginSubscriptionsSchema); if (current === generation) entries.value = result.subscriptions; } catch (e) { if (current === generation) error.value = e instanceof Error ? e.message : String(e); } finally { if (current === generation) busy.value = false; } }
async function remove(id: string): Promise<void> { const entry = entries.value.find(item => item.id === id); if (!entry || !confirmDestructiveAction(`取消“${entry.target}”在会话 ${entry.sessionId} 的订阅？确认后停止后续推送，不会修改账号收藏。`)) return; busy.value = true; error.value = ''; notice.value = ''; const pluginId = props.id; try { await runtimeRequest(`plugins/${pluginId}/subscriptions`, PluginMutationOkSchema, { id }, 'DELETE'); if (pluginId !== props.id) return; notice.value = '已取消订阅；正在准备的投递会在发送前再次检查。'; await load(); } catch (e) { if (pluginId === props.id) error.value = e instanceof Error ? e.message : String(e); } finally { if (pluginId === props.id) busy.value = false; } }
function time(value: number): string { return new Date(value).toLocaleString('zh-CN', { hour12: false }); }
onMounted(load);
watch(() => props.id, () => { entries.value = []; notice.value = ''; void load(); });
</script>
<template><section class="subscriptions"><header><div><h3>已有订阅</h3><p>取消只影响该条订阅；不会修改账号收藏。定时推送总开关在上方配置。</p></div><button type="button" :disabled="busy" @click="load">刷新</button></header><p v-if="error" role="alert" class="error">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p><p v-if="!entries.length && !busy" class="muted">暂无订阅。请在目标会话使用 {{ id === 'bili_video' ? '/订阅 UP主' : '/追番 条目' }} 添加。</p><div v-for="entry in entries" :key="entry.id" class="subscription"><div class="details"><strong>{{ entry.target }}</strong><span>平台 {{ entry.platform }} · 会话 {{ entry.sessionId }} · 发送者 {{ entry.senderId }}</span><span>下次检查：{{ time(entry.nextAt) }}</span><span v-if="entry.error" class="error">{{ entry.error }}</span></div><button type="button" :disabled="busy" @click="remove(entry.id)">取消订阅</button></div></section></template>
<style scoped>
.subscriptions { display:grid;gap:.75rem;border-top:1px solid var(--border-color,#d8e4dc);padding-top:1.25rem;margin-top:1.25rem; }header,.subscription { display:flex;align-items:center;justify-content:space-between;gap:1rem; }h3 { margin:0;font-size:1rem; }p,.details span { margin:.3rem 0 0;color:var(--text-secondary,#68756c);font-size:.82rem;line-height:1.6; }.subscription { border:1px solid var(--border-color,#d8e4dc);border-radius:.65rem;padding:.85rem; }.details { display:grid;gap:.2rem;min-width:0;overflow-wrap:anywhere; }.error,.details .error { color:#a33e36; }.muted { color:#68756c; }button { padding:.45rem .75rem;border:1px solid #d8e4dc;border-radius:.5rem;background:#f1f7f3;color:#356a51;cursor:pointer;flex-shrink:0; }button:disabled { opacity:.45; }@media(max-width:640px){header,.subscription{align-items:flex-start;flex-direction:column}}
</style>
