import { z } from 'zod';

export const WorkspaceAreasSchema = z.object({ skill: z.number().int().nonnegative(), mcp: z.number().int().nonnegative(), cache: z.number().int().nonnegative(), file: z.number().int().nonnegative() }).strict();
export const WorkspaceConversationSchema = z.object({ platform: z.string(), sessionType: z.string(), sessionId: z.string() }).strict();
export const WorkspaceSkillViewSchema = z.object({ id: z.string(), zone: z.enum(['global', 'agent', 'conversation']), agentId: z.string().optional(), conversation: WorkspaceConversationSchema.optional(), name: z.string(), description: z.string(), path: z.string() }).strict();
export const WorkspaceMcpViewSchema = z.object({ id: z.string(), zone: z.enum(['global', 'agent']), agentId: z.string().optional(), transport: z.string(), path: z.string() }).strict();
export const WorkspaceZoneViewSchema = z.object({ id: z.string(), zone: z.enum(['global', 'agent', 'conversation']), label: z.string(), agentId: z.string().optional(), conversation: WorkspaceConversationSchema.optional(), areas: WorkspaceAreasSchema, skills: z.array(WorkspaceSkillViewSchema), mcp: z.array(WorkspaceMcpViewSchema) }).strict();
export const WorkspaceViewSchema = z.object({ workspace: z.object({ root: z.string(), sandbox: z.boolean() }).strict().nullable(), zones: z.array(WorkspaceZoneViewSchema) }).strict();
export type WorkspaceView = z.infer<typeof WorkspaceViewSchema>;
export type WorkspaceZoneView = z.infer<typeof WorkspaceZoneViewSchema>;
export type WorkspaceSkillView = z.infer<typeof WorkspaceSkillViewSchema>;
export type WorkspaceMcpView = z.infer<typeof WorkspaceMcpViewSchema>;
