import type { PermissionGroup, ToolPolicy } from './configV3';

/** Platform decisions are persisted; UI never recalculates schema defaults. */
export function isToolEnabled(name: string, policy: ToolPolicy, platform?: ToolPolicy): boolean {
  if (!platform) return policy.enabled?.[name] === true;
  return platform.enabled?.[name] === true && policy.enabled?.[name] !== false;
}

/** A single switch must never turn its siblings into an implicit allow-list. */
export function setToolEnabled(policy: ToolPolicy, name: string, enabled: boolean): void {
  policy.enabled = { ...policy.enabled, [name]: enabled };
}

export function toolMinimumPermission(
  name: string,
  policy: ToolPolicy,
  builtInMinimum: PermissionGroup = 'OPERATOR',
): PermissionGroup {
  const configured = policy.minimumPermissionGroups?.[name] ?? builtInMinimum;
  return permissionRank(configured) > permissionRank(builtInMinimum) ? configured : builtInMinimum;
}

/** Preserve the tool's built-in lower bound; a user can only raise it per Agent. */
export function setToolMinimumPermission(
  policy: ToolPolicy,
  name: string,
  selected: PermissionGroup,
  builtInMinimum: PermissionGroup = 'OPERATOR',
): void {
  const next = { ...policy.minimumPermissionGroups };
  if (permissionRank(selected) <= permissionRank(builtInMinimum)) delete next[name];
  else next[name] = selected;
  policy.minimumPermissionGroups = next;
}

export function permissionRank(value: PermissionGroup | undefined): number {
  return ({ OPERATOR: 0, ADMIN: 1, SUPER_ADMIN: 2 } as const)[value ?? 'OPERATOR'];
}
