import { z } from 'zod';

const id = z.string().min(1).max(256);
export const QqUploadTemplateSchema = z.object({ id, enabled: z.boolean().default(true), groupIds: z.array(id).max(1000).default([]), filePatterns: z.array(z.string().min(1).max(120)).min(1).max(30), prompt: z.string().min(1).max(8000), skillLibraries: z.array(id).max(30).default([]) }).strict();
export const QqFileSettingsSchema = z.object({ enabled: z.boolean().default(false), access_mode: z.enum(['all', 'allowlist', 'denylist']).default('all'), group_list: z.array(id).max(1000).default([]), max_file_list_limit: z.number().int().min(1).max(100).default(50), max_search_folders: z.number().int().min(1).max(200).default(30), upload_auto_process: z.boolean().default(false), uploadTemplates: z.array(QqUploadTemplateSchema).max(100).default([]) }).strict();
export type QqFileSettings = z.infer<typeof QqFileSettingsSchema>;
const groupId = id.nullable().describe('Use null for the current QQ group. A different group requires resources.manage permission.');
const folderId = id.nullable().describe('Folder ID returned by qq_file. Use null for the group root.');
const fileId = id.describe('Exact file_id returned by qq_file or qq_search_files. This is not a filename or download URL.');
export const QqFileArgs = z.object({
  group_id: groupId,
  source: z.enum(['group_file', 'group_album']).describe('Select group files or group albums.'),
  folder_id: folderId,
  album_id: id.nullable().describe('Album ID returned by qq_file. Use null to list albums. Used only with group_album.'),
  cursor: z.string().max(4000).nullable().describe('Use null for the first page. Copy next_cursor from the previous response without changes. Keep group, source, folder, and album unchanged.'),
  limit: z.number().int().min(1).max(100).describe('Maximum items in this page. The configured limit can be lower.'),
});
export const QqMembersArgs = z.object({ group_id: groupId, page: z.number().int().min(1).max(10000).describe('Page number. Start at 1. Continue only when has_more is true.'), page_size: z.number().int().min(1).max(100).describe('Maximum members in each page.'), keyword: z.string().max(200).nullable().describe('Literal text in nickname, group card, or user ID. Use null for no text filter.'), role: z.enum(['owner', 'admin', 'member']).nullable().describe('Member role filter. Use null for all roles.'), no_cache: z.boolean().describe('Use true to ask NapCat for fresh member data.') });
export const QqSearchArgs = z.object({ group_id: groupId, keyword: z.string().min(1).max(200).describe('Literal part of the filename. Matching ignores case. Wildcards are not supported.'), folder_id: folderId, recursive: z.boolean().describe('Use true to search subfolders within the configured traversal limit.'), limit: z.number().int().min(1).max(100).describe('Maximum matching files to return.') });
export const QqInfoArgs = z.object({ group_id: groupId, file_id: fileId, folder_id: folderId });
export const QqUrlArgs = z.object({ group_id: groupId, file_id: fileId, busid: z.number().int().nonnegative().nullable().describe('busid from the file listing. Use null when the listing does not provide it.') });
export const QqUploadArgs = z.object({ group_id: groupId, artifact_id: id.nullable().describe('Authorized artifact ID. Supply this or workspace_path, never both. Use null when supplying a path.'), workspace_path: z.string().min(1).max(1000).nullable().describe('Existing workspace file path. Use a path returned by file tools. Use null when supplying artifact_id. URLs are not accepted.'), filename: z.string().min(1).max(255).regex(/^[^/\\]+$/).refine(value => Array.from(value).every(char => char.charCodeAt(0) >= 32), 'Control characters are not allowed').describe('Filename shown in QQ. Include its extension. Do not include a directory.'), folder_id: folderId });
export const QqDeleteArgs = z.object({ group_id: groupId, file_ids: z.array(fileId).min(1).max(50).describe('Exact file IDs selected for deletion. Do not include files already reported as deleted.') });
export const QqFolderArgs = z.object({ group_id: groupId, folder_id: id.describe('Exact folder_id returned by qq_file. Deletion also removes its contents.') });
export const QqGroupArgs = z.object({ group_id: groupId });
export const QqNoticePublishArgs = z.object({ group_id: groupId, content: z.string().min(1).max(10000).describe('Complete text of the new group announcement.') });
export const QqNoticeDeleteArgs = z.object({ group_id: groupId, notice_id: id.describe('Exact notice ID returned by qq_group_notices.') });
export const QQ_READ_TOOLS = ['qq_file', 'qq_group_members', 'qq_get_file_download_url', 'qq_search_files', 'qq_get_file_info', 'qq_group_info', 'qq_group_notices'] as const;
export const QQ_WRITE_TOOLS = ['qq_request_file_upload', 'qq_delete_files', 'qq_delete_folder', 'qq_publish_group_notice', 'qq_delete_group_notice'] as const;
export const QQ_TOOLS = [...QQ_READ_TOOLS, ...QQ_WRITE_TOOLS] as const;
export type QqToolName = typeof QQ_TOOLS[number];
