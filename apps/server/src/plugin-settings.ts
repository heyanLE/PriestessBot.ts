import { z } from 'zod';
import { PluginRecordSchema, PluginIdSchema, type PluginId, type PluginRecord } from '../../../packages/contracts/src/plugins/index.js';
import type { RuntimeStore } from '../../../packages/core/src/storage.js';
export class PluginSettings {
 constructor(private readonly store:RuntimeStore) {}
 get(id:PluginId):PluginRecord { return this.store.get('native-plugins',id,PluginRecordSchema) ?? PluginRecordSchema.parse({id,revision:0,settings:{}}); }
 list():PluginRecord[] { return PluginIdSchema.options.map(id=>this.get(id)); }
 update(id:PluginId,raw:unknown,expectedRevision:number):PluginRecord {
  z.number().int().nonnegative().parse(expectedRevision);
  if(this.get(id).revision!==expectedRevision) throw new Error('Plugin revision conflict');
  const next=PluginRecordSchema.parse({id,revision:expectedRevision+1,settings:raw});this.store.put('native-plugins',id,next);return next;
 }
}
