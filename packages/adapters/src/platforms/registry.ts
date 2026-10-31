import type { PlatformConfig } from '../../../contracts/src/index.js';
import type { AdapterDependencies, PlatformAdapter } from './types.js';
import { TelegramAdapter } from './telegram.js';
import { NapCatAdapter } from './napcat.js';
import { WeixinAdapter } from './weixin.js';
export function createPlatformAdapter(config: PlatformConfig, deps: AdapterDependencies): PlatformAdapter {
  switch (config.type) {
    case 'telegram': return new TelegramAdapter(config, deps);
    case 'napcat': return new NapCatAdapter(config, deps);
    case 'weixin': return new WeixinAdapter(config, deps);
  }
}
