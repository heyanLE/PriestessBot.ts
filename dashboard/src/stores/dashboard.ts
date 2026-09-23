import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useConfigV3Store } from './configV3';
import { executionsApi } from '../api/executions';
import {
  dashboardApi,
  type ConfigurationBackupView,
  type ConversationDto,
  type EffectiveConfigurationResponse,
  type HealthResponse,
  type PlatformStatusDto,
  type PluginListResponse,
  type ProviderDto,
  type RawGlobalConfigurationResponse,
  type ToolDto,
  type WorkingDirectorySummaryResponse,
  type WorkspaceListResponse,
  type WorkspaceReloadResult,
} from '../api/dashboard';

export const useDashboardStore = defineStore('dashboard', () => {
  const health = ref<HealthResponse | null>(null);
  const rawConfiguration = ref<RawGlobalConfigurationResponse | null>(null);
  const effectiveConfiguration = ref<EffectiveConfigurationResponse | null>(null);
  const config = ref<null>(null);
  const configBackups = ref<ConfigurationBackupView[]>([]);
  const workingDirectory = ref<WorkingDirectorySummaryResponse | null>(null);
  const platforms = ref<PlatformStatusDto[]>([]);
  const providers = ref<ProviderDto[]>([]);
  const providerTests = ref<Record<string, boolean>>({});
  const tools = ref<ToolDto[]>([]);
  const workspaces = ref<WorkspaceListResponse>({ workspaces: [] });
  const conversations = ref<ConversationDto[]>([]);
  const plugins = ref<PluginListResponse>({ plugins: [], extensions: [] });
  const loading = ref(false);
  const error = ref<string | null>(null);
  const executionTotal = ref(0);
  const lastUpdated = ref<number | null>(null);

  const runningPlatforms = computed(() => platforms.value.filter((item) => item.running).length);
  const enabledPlatforms = computed(() => platforms.value.filter((item) => item.enabled).length);
  const enabledPlugins = computed(() => plugins.value.plugins.filter((item) => item.state === 'ENABLED').length);

  async function refreshAll() {
    loading.value = true;
    error.value = null;
    try {
      const configStore = useConfigV3Store();
      const results = await Promise.allSettled([
        dashboardApi.health().then(value => { health.value = value; }),
        dashboardApi.platforms().then(value => { platforms.value = value; }),
        dashboardApi.providers().then(value => { providers.value = value; }),
        dashboardApi.tools().then(value => { tools.value = value; }),
        dashboardApi.conversations().then(value => { conversations.value = value; }),
        dashboardApi.plugins().then(value => { plugins.value = value; }),
        executionsApi.list({ limit: 1, offset: 0 }).then(value => { executionTotal.value = value.total; }),
        configStore.load(!configStore.dirty),
      ]);
      const failures = results.filter((item): item is PromiseRejectedResult => item.status === 'rejected');
      if (failures.length) error.value = failures.map(item => String(item.reason)).join('；');
      lastUpdated.value = Date.now();
    } finally {
      loading.value = false;
    }
  }

  async function testProviders() { providerTests.value = await dashboardApi.testProviders(); }
  async function loadWorkspaces() { workspaces.value = await dashboardApi.workspaces(); }
  async function reloadWorkspace(id: string): Promise<WorkspaceReloadResult> {
    const result = await dashboardApi.reloadWorkspace(id); await loadWorkspaces(); return result;
  }
  async function reloadWorkspaces(): Promise<WorkspaceReloadResult[]> {
    const result = await dashboardApi.reloadWorkspaces(); await loadWorkspaces(); return result;
  }
  async function discoverPlugins() { plugins.value = await dashboardApi.discoverPlugins(); }
  async function setPluginState(id: string, action: 'load' | 'unload' | 'enable' | 'disable') {
    const api = { load: dashboardApi.loadPlugin, unload: dashboardApi.unloadPlugin, enable: dashboardApi.enablePlugin, disable: dashboardApi.disablePlugin }[action];
    plugins.value = await api(id);
  }
  async function loadConfigBackups() { configBackups.value = await dashboardApi.configBackups(); }
  async function restoreConfigBackup(id: string) { await dashboardApi.restoreConfigBackup(id); await refreshAll(); }
  async function setPlatformEnabled(_name: string, _enabled: boolean) { throw new Error('Edit platform enabled state through the v2 configuration editor.'); }
  async function updateToolAllowance(_name: string, _allowed: boolean) { throw new Error('Edit Workspace toolPolicy through the v2 configuration editor.'); }

  return {
    health, rawConfiguration, effectiveConfiguration, config, configBackups, workingDirectory,
    platforms, providers, providerTests, tools, workspaces, conversations, plugins, loading, error,
    executionTotal, lastUpdated, runningPlatforms, enabledPlatforms, enabledPlugins, refreshAll, testProviders,
    loadWorkspaces, reloadWorkspace, reloadWorkspaces, discoverPlugins, setPluginState,
    loadConfigBackups, restoreConfigBackup, setPlatformEnabled, updateToolAllowance,
  };
});
