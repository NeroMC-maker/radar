/**
 * Estados editoriales. Única definición: la usan backend, worker e interfaz.
 *
 * draft → in_review → approved → scheduled | queued → publishing → published
 * Alternativos: rejected, cancelled, needs_review, failed, unconfirmed
 */
export const DRAFT_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'scheduled',
  'queued',
  'publishing',
  'published',
  'rejected',
  'cancelled',
  'needs_review',
  'failed',
  'unconfirmed',
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  draft: 'Borrador',
  in_review: 'En revisión',
  approved: 'Aprobado',
  scheduled: 'Programado',
  queued: 'En cola',
  publishing: 'Publicando',
  published: 'Publicado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
  needs_review: 'Requiere nueva revisión',
  failed: 'Fallido',
  unconfirmed: 'Resultado pendiente de confirmar',
};

/** Estados desde los que un aprobador puede autorizar la versión actual. */
export const APPROVABLE: readonly DraftStatus[] = ['draft', 'in_review', 'needs_review', 'failed'];

/** Estados con una aprobación vigente que todavía no empezó a enviarse. */
export const APPROVED_PENDING_SEND: readonly DraftStatus[] = ['approved', 'scheduled', 'queued'];

/** Estados donde el contenido se puede modificar. Editar en APPROVED_PENDING_SEND invalida la aprobación. */
export const EDITABLE: readonly DraftStatus[] = [
  'draft',
  'in_review',
  'needs_review',
  'rejected',
  'failed',
  ...APPROVED_PENDING_SEND,
];

/** Estados que esperan una decisión humana (bandeja de pendientes). */
export const PENDING_DECISION: readonly DraftStatus[] = ['in_review', 'needs_review', 'unconfirmed', 'failed'];

/** Estados en los que ya no tiene sentido avisar ni recordar. */
export const NO_LONGER_NEEDS_NOTICE: readonly DraftStatus[] = [
  'approved',
  'scheduled',
  'queued',
  'publishing',
  'published',
  'rejected',
  'cancelled',
];

export const DISCARDABLE: readonly DraftStatus[] = [
  'draft',
  'in_review',
  'needs_review',
  'failed',
  ...APPROVED_PENDING_SEND,
];

export const is = (status: string, set: readonly DraftStatus[]) => set.includes(status as DraftStatus);

/** Tras editar el contenido: a qué estado pasa el borrador. */
export function statusAfterEdit(current: DraftStatus): DraftStatus {
  if (!is(current, EDITABLE)) throw new Error(`No se puede editar un borrador en estado ${current}`);
  if (is(current, APPROVED_PENDING_SEND)) return 'needs_review';
  if (current === 'draft') return 'draft';
  return 'in_review';
}
