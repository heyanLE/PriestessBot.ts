export interface AgentWorkbenchSavePayload {
  readonly agentId: string;
  readonly personaId: string | null;
  readonly expectedBindingRevision: number;
}
export interface AgentWorkbenchBindingDraft extends AgentWorkbenchSavePayload {
  readonly dirty: boolean;
  readonly ready: boolean;
  readonly publishedPersonaId: string | null;
}
