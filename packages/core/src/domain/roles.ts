export const ROLES = ['owner', 'editor', 'approver'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Propietario',
  editor: 'Editor',
  approver: 'Aprobador',
};

/** Capacidades del producto y qué roles las otorgan. Fuente única para backend e interfaz. */
export const CAPABILITIES = {
  'org.manage': ['owner'],
  'members.manage': ['owner'],
  'connections.manage': ['owner'],
  'brand.configure': ['owner'],
  'brand.read': ['owner', 'editor', 'approver'],
  'research.read': ['owner', 'editor', 'approver'],
  'draft.create': ['editor'],
  'draft.edit': ['editor'],
  'draft.discard': ['editor', 'approver'],
  'draft.approve': ['approver'],
  'notifications.self': ['owner', 'editor', 'approver'],
  'feedback.create': ['owner', 'editor', 'approver'],
  'operations.read': ['owner'],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(roles: readonly string[], capability: Capability): boolean {
  const allowed: readonly Role[] = CAPABILITIES[capability];
  return roles.some((r) => allowed.includes(r as Role));
}
