import type { MessageEvent, PlatformConfig } from '../../../contracts/src/index.js';
import { createPlatformAdapter } from './registry.js';
import type { AdapterDependencies, PlatformAdapter, PlatformStatus } from './types.js';

interface PlatformInstance {
  readonly config: PlatformConfig;
  readonly adapter: PlatformAdapter;
  status: PlatformStatus;
}
type AdapterFactory = (config: PlatformConfig, dependencies: AdapterDependencies) => PlatformAdapter;

/** Owns adapter instances; only the current instance may report status or submit ingress. */
export class PlatformManager {
  private readonly instances = new Map<string, PlatformInstance>();
  private operation: Promise<void> = Promise.resolve();
  constructor(private readonly factory: AdapterFactory = createPlatformAdapter) {}
  get(id: string): PlatformAdapter | undefined { return this.instances.get(id)?.adapter; }
  status(): PlatformStatus[] { return [...this.instances.values()].map(instance => ({ ...instance.status })); }
  reconcile(configs: readonly PlatformConfig[], dependencies: AdapterDependencies, receive: (event: MessageEvent, adapter: PlatformAdapter) => Promise<void>): Promise<void> {
    const operation = this.operation.then(async () => {
      const desired = new Map(configs.map(config => [config.id, config]));
      for (const [id, instance] of this.instances) {
        const config = desired.get(id);
        if (config && JSON.stringify(config) === JSON.stringify(instance.config) && instance.status.status !== 'stopped') continue;
        // Invalidate ownership before awaiting stop so late callbacks cannot revive an old instance.
        this.instances.delete(id);
        await instance.adapter.stop();
      }
      await Promise.all(configs.map(async config => {
        if (this.instances.has(config.id)) return;
        const adapter = this.factory(config, {
          ...dependencies,
          onStatus: (id, state) => {
            const current = this.instances.get(id);
            if (!current || current.adapter !== adapter || !current.config.enabled || current.status.status === 'stopped') return;
            current.status = { id, ...state };
            dependencies.onStatus?.(id, state);
          },
        });
        const instance: PlatformInstance = { config, adapter, status: { id: config.id, status: config.enabled ? 'starting' : 'disabled' } };
        this.instances.set(config.id, instance);
        if (!config.enabled) return;
        try {
          await adapter.start(event => {
            if (this.instances.get(config.id) !== instance || instance.status.status === 'stopped') return Promise.resolve();
            return receive(event, adapter);
          });
        } catch {
          if (this.instances.get(config.id) === instance) instance.status = { id: config.id, status: 'error', message: 'Connection failed; verify configuration and credentials' };
        }
      }));
    });
    this.operation = operation.catch(() => undefined);
    return operation;
  }
  stop(): Promise<void> {
    const operation = this.operation.then(async () => {
      const instances = [...this.instances.values()];
      this.instances.clear();
      await Promise.all(instances.map(instance => instance.adapter.stop()));
      for (const instance of instances) this.instances.set(instance.config.id, { ...instance, status: { id: instance.config.id, status: instance.config.enabled ? 'stopped' : 'disabled' } });
    });
    this.operation = operation.catch(() => undefined);
    return operation;
  }
}
