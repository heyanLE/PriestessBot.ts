import { z } from 'zod';
import { QqFileSettingsSchema } from './qq-file.js';
import { BilibiliSettingsSchema } from './bilibili.js';
import { BangumiSettingsSchema } from './bangumi.js';
import { MarkdownSettingsSchema } from './markdown.js';
import { ReminiscenceSettingsSchema } from './reminiscence.js';
const revision = z.number().int().nonnegative();
export const PluginIdSchema = z.enum(['qq_file','markdown_killer','bili_video','bangumi','local_reminiscence']);
export type PluginId = z.infer<typeof PluginIdSchema>;
export const PluginRecordSchema = z.discriminatedUnion('id', [
  z.object({ id:z.literal('qq_file'), revision, settings:QqFileSettingsSchema }),
  z.object({ id:z.literal('markdown_killer'), revision, settings:MarkdownSettingsSchema }),
  z.object({ id:z.literal('bili_video'), revision, settings:BilibiliSettingsSchema }),
  z.object({ id:z.literal('bangumi'), revision, settings:BangumiSettingsSchema }),
  z.object({ id:z.literal('local_reminiscence'), revision, settings:ReminiscenceSettingsSchema }),
]);
export type PluginRecord = z.infer<typeof PluginRecordSchema>;
export const PluginCatalogueSchema = z.object({ plugins:z.array(z.object({ id:PluginIdSchema, name:z.string(), description:z.string(), source:z.url(), record:PluginRecordSchema, tools:z.array(z.string()), commands:z.array(z.string()), status:z.enum(['enabled','disabled','failed']), diagnostic:z.string() })) });
export const PluginToolCatalogueSchema = z.object({ tools:z.array(z.object({id:z.string(),label:z.string(),detail:z.string()})) });
export const pluginMetadata: Record<PluginId,{name:string;description:string;source:string;commands:string[]}> = {
 qq_file:{name:'QQ 群文件与管理',description:'群文件、相册、成员、公告及文件上传自动处理',source:'https://github.com/xkeyC/astrbot_plugin_qq_file',commands:[]},
 markdown_killer:{name:'Markdown 消息整理',description:'整理消息格式，渲染表格和公式图片',source:'https://github.com/xkeyC/astrbot_plugin_markdown_killer',commands:[]},
 bili_video:{name:'哔哩哔哩',description:'视频、字幕、总结、内容检索及 UP 订阅',source:'https://github.com/xkeyC/astrbot_plugin_biliVideo',commands:['/总结','/重新总结','/最新视频','/订阅','/取消订阅','/订阅列表','/检查更新','/识别开关','/B站登录']},
 bangumi:{name:'Bangumi 番剧',description:'条目、放送日历、收藏与追番提醒',source:'https://github.com/xkeyC/astrbot_plugin_bangumi',commands:['/bgm','/today','/calendar','/追番','/弃坑','/追番列表','/bgm模板']},
 local_reminiscence:{name:'本地回忆',description:'按发送者和会话整理事件、反思、主题及记忆节点',source:'https://github.com/xkeyC/astrbot_plugin_local_reminiscence',commands:[]},
};
export const PluginStatusSchema=z.object({details:z.array(z.object({label:z.string(),value:z.string()}))});
export const PluginQrSchema=z.object({id:z.string(),url:z.url(),expiresAt:z.number()});
export const PluginQrPollSchema=z.object({status:z.enum(['waiting','scanned','success','expired'])});

export const PluginSubscriptionsSchema = z.object({ subscriptions: z.array(z.object({ id: z.string(), platform: z.string(), sessionId: z.string(), senderId: z.string(), target: z.string(), nextAt: z.number(), error: z.string() })) });
export type PluginSubscriptions = z.infer<typeof PluginSubscriptionsSchema>;
export const PluginMutationOkSchema = z.object({ ok: z.literal(true) });
