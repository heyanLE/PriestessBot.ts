import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { configV3Api, type ConfigResult } from '../api/configV3';
import { validateConfiguration, type AgentPresetView, type ApplicationConfig } from '../models/configV3';
export const useConfigV3Store = defineStore('config-v3', () => {
  const document = ref<ApplicationConfig | null>(null);
  /** Preset roster reported by the runtime; the editor renders this instead of a hardcoded list. */
  const presets = ref<AgentPresetView[]>([]);
  /** Accepted compression strategy values, likewise from the runtime. */
  const compressionStrategies = ref<string[]>([]);
  const revision = ref('');
  const sourcePath = ref('');
  const baseline = ref('');
  const busy = ref(false);
  const error = ref('');
  const notice = ref('');
  const result = ref<ConfigResult | null>(null);
  const content = computed(() => JSON.stringify(document.value, null, 2));
  const dirty = computed(() => !!document.value && content.value !== baseline.value);
  const validation = computed(() => (document.value ? validateConfiguration(document.value) : []));
  const previewed = ref('');
  const canSave = computed(
    () =>
      dirty.value &&
      !!revision.value &&
      !busy.value &&
      !validation.value.length &&
      result.value?.success &&
      previewed.value === content.value,
  );
  async function load(force = false) {
    if (busy.value || (document.value && !force)) return;
    busy.value = true;
    error.value = '';
    try {
      const [response, roster, strategies] = await Promise.all([
        configV3Api.read(),
        // A failure here must not block editing, so both rosters degrade to empty and the editor keeps
        // the Agent's current values selectable.
        configV3Api.agentPresets().catch(() => [] as AgentPresetView[]),
        configV3Api.compressionStrategies().catch(() => [] as string[]),
      ]);
      presets.value = roster ?? [];
      compressionStrategies.value = strategies ?? [];
      document.value = response.document;
      revision.value = response.revision ?? '';
      sourcePath.value = response.sourcePath;
      baseline.value = content.value;
      previewed.value = '';
      result.value = response.diagnostics.length
        ? { success: false, diagnostics: response.diagnostics }
        : null;
    } catch (cause) {
      error.value = message(cause);
    } finally {
      busy.value = false;
    }
  }
  async function preview() {
    if (busy.value || validation.value.length || !document.value) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    const submitted = content.value;
    try {
      result.value = await configV3Api.preview(submitted);
      previewed.value = result.value.success ? submitted : '';
    } catch (cause) {
      error.value = message(cause);
    } finally {
      busy.value = false;
    }
  }
  async function save() {
    if (!canSave.value) return;
    busy.value = true;
    error.value = '';
    const submitted = content.value;
    try {
      result.value = await configV3Api.save(submitted, revision.value);
      if (result.value.success) {
        const saved = await configV3Api.read();
        revision.value = saved.revision ?? '';
        baseline.value = JSON.stringify(saved.document, null, 2);
        // Editing is disabled while saving; never overwrite another tab's unrelated concurrent draft.
        if (content.value === submitted) document.value = saved.document;
        previewed.value = '';
        notice.value = result.value.pendingRestartPaths?.length
          ? '修订已保存，部分设置重启后生效。'
          : '修订已保存并生效。';
      }
    } catch (cause) {
      error.value = message(cause);
    } finally {
      busy.value = false;
    }
  }
  async function reload() {
    if (dirty.value || busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      result.value = await configV3Api.reload();
      notice.value = result.value.success ? '已从磁盘重新加载。' : '';
    } catch (cause) {
      error.value = message(cause);
    } finally {
      busy.value = false;
    }
    if (result.value?.success) await load(true);
  }
  const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
  return {
    document,
    presets,
    compressionStrategies,
    baseline,
    revision,
    sourcePath,
    busy,
    error,
    notice,
    result,
    content,
    dirty,
    validation,
    canSave,
    previewed,
    load,
    preview,
    save,
    reload,
  };
});
