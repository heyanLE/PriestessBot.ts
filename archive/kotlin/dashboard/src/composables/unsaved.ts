import { computed, onBeforeUnmount, ref } from 'vue';
import { useRoute } from 'vue-router';

interface DraftEntry { readonly label: string; readonly page: string; readonly dirty: () => boolean; }
const entries = new Map<symbol, DraftEntry>();
const generation = ref(0);
export const unsavedDrafts = computed(() => {
  generation.value;
  return [...entries.values()].filter(entry => entry.dirty()).map(({ label, page }) => ({ label, page }));
});

export function createDraftState(value: () => unknown) {
  const original = ref(JSON.stringify(value()));
  const dirty = computed(() => original.value !== undefined && JSON.stringify(value()) !== original.value);
  function markSaved(): void { original.value = JSON.stringify(value()); }
  return { dirty, markSaved };
}
export function registerUnsavedDraft(label: string, page: string, dirty: () => boolean): () => void {
  const key = Symbol(label);
  entries.set(key, { label, page, dirty }); generation.value++;
  return () => { entries.delete(key); generation.value++; };
}

/** Draft values stay in memory; credentials and edited content never enter browser storage. */
export function useUnsavedDraft(label: string, value: () => unknown, page?: string) {
  const route = useRoute();
  const { dirty, markSaved } = createDraftState(value);
  const unregister = registerUnsavedDraft(label, page ?? route.path, () => dirty.value);
  onBeforeUnmount(unregister);
  function confirmDiscard(): boolean { return !dirty.value || window.confirm(`“${label}”有未保存修改。放弃这些修改并继续？`); }
  return { dirty, markSaved, confirmDiscard };
}

export function confirmUnsavedDrafts(page?: string, extra: readonly string[] = []): boolean {
  const labels = [...new Set([...extra, ...unsavedDrafts.value.filter(entry => page === undefined || entry.page === page).map(entry => entry.label)])];
  return !labels.length || window.confirm(`以下内容有未保存修改：\n${labels.join('、')}\n\n放弃这些修改并继续？`);
}
export function confirmDestructiveAction(message: string): boolean { return window.confirm(message); }
