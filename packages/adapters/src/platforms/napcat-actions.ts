import { z } from 'zod';
import { protocolId } from './transport.js';

const group = z.object({ group_id: z.string().min(1) });
export const NapCatActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get_group_root_files'), params: group }),
  z.object({ action: z.literal('get_group_files_by_folder'), params: group.extend({ folder_id: z.string() }) }),
  z.object({ action: z.literal('get_group_file_url'), params: group.extend({ file_id: z.string(), busid: z.number().int().optional() }) }),
  z.object({ action: z.literal('get_group_member_list'), params: group.extend({ no_cache: z.boolean().optional() }) }),
  z.object({ action: z.literal('get_group_info'), params: group }),
  z.object({ action: z.literal('get_qun_album_list'), params: group.extend({ attach_info: z.string() }) }),
  z.object({ action: z.literal('get_group_album_media_list'), params: group.extend({ album_id: z.string(), attach_info: z.string() }) }),
  z.object({ action: z.literal('upload_group_file'), params: group.extend({ file: z.string().url(), name: z.string(), folder_id: z.string().optional() }) }),
  z.object({ action: z.literal('delete_group_file'), params: group.extend({ file_id: z.string() }) }),
  z.object({ action: z.literal('delete_group_folder'), params: group.extend({ folder_id: z.string() }) }),
  z.object({ action: z.literal('_get_group_notice'), params: group }),
  z.object({ action: z.literal('_send_group_notice'), params: group.extend({ content: z.string() }) }),
  z.object({ action: z.literal('_del_group_notice'), params: group.extend({ notice_id: z.string() }) }),
]);
export type NapCatAction = z.infer<typeof NapCatActionSchema>;
export const GroupFileSchema = z.object({ file_id: z.string(), file_name: z.string(), file_size: z.number().nonnegative().default(0), busid: z.number().int().optional(), upload_time: z.number().optional(), uploader: protocolId.optional(), uploader_name: z.string().optional() });
export const GroupFolderSchema = z.object({ folder_id: z.string(), folder_name: z.string(), total_file_count: z.number().optional(), create_time: z.number().optional() });
export const GroupFilesSchema = z.object({ files: z.array(GroupFileSchema).default([]), folders: z.array(GroupFolderSchema).default([]) });
export const GroupMembersSchema = z.array(z.object({ user_id: protocolId, nickname: z.string().default(''), card: z.string().default(''), role: z.enum(['owner', 'admin', 'member']).default('member'), join_time: z.number().optional(), last_sent_time: z.number().optional() }));
export const GroupInfoSchema = z.object({ group_id: protocolId, group_name: z.string(), member_count: z.number().optional(), max_member_count: z.number().optional() });
const mediaFields = z.object({ id: protocolId.optional(), media_id: protocolId.optional(), lloc: z.string().optional(), name: z.string().optional(), file_name: z.string().optional(), url: z.string().optional(), origin_url: z.string().optional(), original_url: z.string().optional(), download_url: z.string().optional(), file_size: z.union([z.number(), z.string()]).optional(), size: z.union([z.number(), z.string()]).optional(), width: z.number().optional(), height: z.number().optional() });
const mediaItem = mediaFields.extend({ image: mediaFields.optional(), video: mediaFields.optional() });
const mediaFeed = mediaItem.extend({ cell_media: z.object({ album_id: z.string().optional(), batch_id: z.string().optional(), media_items: z.array(mediaItem) }).optional(), cell_common: z.object({ time: z.number().optional() }).optional(), cell_user_info: z.object({ user: z.object({ uin: protocolId.optional(), nickname: z.string().optional() }).optional() }).optional() });
export const AlbumListSchema = z.object({ album_list: z.array(z.object({ album_id: protocolId.optional(), id: protocolId.optional(), album_name: z.string().optional(), name: z.string().optional(), title: z.string().optional(), cover_url: z.string().optional(), media_count: z.number().optional(), photo_count: z.number().optional() })).default([]), attach_info: z.string().default(''), has_more: z.union([z.boolean(), z.number()]).default(false).transform(Boolean) });
export const AlbumMediaSchema = z.object({ media_list: z.array(mediaFeed).optional(), feed_list: z.array(mediaFeed).optional(), feeds: z.array(mediaFeed).optional(), attach_info: z.string().default(''), has_more: z.union([z.boolean(), z.number()]).default(false).transform(Boolean) });
export const GroupNoticesSchema = z.array(z.object({ notice_id: z.string(), sender_id: protocolId.optional(), publish_time: z.number().optional(), message: z.object({ text: z.string(), images: z.array(z.object({ id: z.string().optional(), width: z.union([z.string(), z.number()]).optional(), height: z.union([z.string(), z.number()]).optional() })).optional() }) }));
export type NapCatActionResult =
  | { kind: 'files'; data: z.infer<typeof GroupFilesSchema> }
  | { kind: 'url'; data: { url: string } }
  | { kind: 'members'; data: z.infer<typeof GroupMembersSchema> }
  | { kind: 'group'; data: z.infer<typeof GroupInfoSchema> }
  | { kind: 'albums'; data: z.infer<typeof AlbumListSchema> }
  | { kind: 'media'; data: z.infer<typeof AlbumMediaSchema> }
  | { kind: 'notices'; data: z.infer<typeof GroupNoticesSchema> }
  | { kind: 'mutation'; data: { success: true } };
