import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { approvals, brands, draftVersions, drafts, publications, socialAccounts } from '../db/schema';
import { contentHash } from '../domain/content-hash';
import { APPROVABLE, is } from '../domain/draft-states';
import { zonedLocalToUtc } from '../domain/time';
import { conflict, forbidden, invalid } from '../errors';
import type { Services } from '../services';
import { audit } from './audit';
import { X_MAX_LENGTH, lockDraft, revokePendingApproval } from './drafts';
import { requireCap, type Actor } from './identity';

export const approveSchema = z.object({
  draftId: z.string().uuid(),
  /** La versión exacta que la persona tenía en pantalla */
  versionId: z.string().uuid(),
  /** "YYYY-MM-DDTHH:MM" en la zona horaria de la marca; vacío = publicar ahora */
  scheduleLocal: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
});

export type ApproveResult = { publicationId: string; status: 'queued' | 'scheduled'; alreadyApproved: boolean };

/**
 * Aprueba una versión exacta y solicita su envío en UNA transacción:
 * si el proceso se interrumpe, no queda una aprobación sin envío ni un envío sin aprobación.
 * Repetir la llamada (doble pulsación) devuelve la misma publicación.
 */
export async function approveAndPublish(svc: Services, actor: Actor, raw: z.input<typeof approveSchema>): Promise<ApproveResult> {
  requireCap(actor, 'draft.approve');
  const input = approveSchema.parse(raw);

  return svc.db.transaction(async (tx) => {
    const draft = await lockDraft(tx, actor, input.draftId);

    // Idempotencia: ya existe una aprobación vigente para esta misma versión.
    const [existing] = await tx
      .select({ approval: approvals, publication: publications })
      .from(approvals)
      .innerJoin(publications, eq(publications.approvalId, approvals.id))
      .where(
        and(
          eq(approvals.draftId, draft.id),
          eq(approvals.draftVersionId, input.versionId),
          isNull(approvals.invalidatedAt),
        ),
      )
      .orderBy(desc(approvals.createdAt))
      .limit(1);
    if (existing && existing.publication.status !== 'cancelled' && existing.publication.status !== 'failed') {
      return {
        publicationId: existing.publication.id,
        status: existing.publication.status === 'scheduled' ? 'scheduled' : 'queued',
        alreadyApproved: true,
      };
    }

    if (draft.currentVersionId !== input.versionId) {
      throw conflict('El contenido cambió desde que lo abriste. Revisa la versión actual antes de aprobar.');
    }
    if (!is(draft.status, APPROVABLE)) throw conflict('Esta propuesta no está pendiente de aprobación');

    const [version] = await tx.select().from(draftVersions).where(eq(draftVersions.id, input.versionId));
    if (!version) throw conflict('Versión no encontrada');
    if (!draft.socialAccountId) throw invalid('Elige una cuenta de destino');
    const [account] = await tx
      .select()
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.id, draft.socialAccountId),
          eq(socialAccounts.orgId, actor.orgId),
          eq(socialAccounts.brandId, draft.brandId),
        ),
      );
    if (!account) throw invalid('La cuenta de destino no pertenece a esta marca');
    if (account.status !== 'connected') throw invalid('La cuenta de destino necesita reconectarse');
    if (account.mode === 'live' && !account.liveEnabled) {
      throw forbidden('La publicación real está deshabilitada para esta cuenta. El propietario debe habilitarla.');
    }

    // Integridad: lo que se aprueba es exactamente texto + recursos + destino de esta versión.
    const hash = contentHash({ text: version.text, assets: version.assets, socialAccountId: account.id });
    if (hash !== version.contentHash) throw conflict('El destino cambió; revisa la propuesta de nuevo');
    if (version.text.length > X_MAX_LENGTH) throw invalid(`El texto supera ${X_MAX_LENGTH} caracteres`);

    const [brand] = await tx.select().from(brands).where(eq(brands.id, draft.brandId));
    let runAt = new Date();
    let status: 'queued' | 'scheduled' = 'queued';
    if (input.scheduleLocal) {
      runAt = zonedLocalToUtc(input.scheduleLocal, brand!.timezone);
      if (runAt.getTime() < Date.now() - 60_000) throw invalid('La hora programada ya pasó');
      status = 'scheduled';
    }

    const [approval] = await tx
      .insert(approvals)
      .values({
        orgId: actor.orgId,
        draftId: draft.id,
        draftVersionId: version.id,
        socialAccountId: account.id,
        contentHash: hash,
        approvedBy: actor.userId,
      })
      .returning();
    const [publication] = await tx
      .insert(publications)
      .values({
        orgId: actor.orgId,
        draftId: draft.id,
        approvalId: approval!.id,
        draftVersionId: version.id,
        socialAccountId: account.id,
        status,
        runAt,
        scheduledTimezone: status === 'scheduled' ? brand!.timezone : null,
        idempotencyKey: `pub:${approval!.id}`,
      })
      .returning();
    await tx.update(drafts).set({ status, updatedAt: new Date() }).where(eq(drafts.id, draft.id));
    await audit(tx, {
      orgId: actor.orgId,
      userId: actor.userId,
      action: 'draft.approved',
      entity: 'draft',
      entityId: draft.id,
      data: { versionId: version.id, versionNumber: version.number, accountId: account.id, runAt: runAt.toISOString(), status },
    });
    return { publicationId: publication!.id, status, alreadyApproved: false };
  });
}

/** Cancela un envío programado que no empezó; la propuesta vuelve a revisión. */
export async function cancelScheduled(svc: Services, actor: Actor, draftId: string) {
  requireCap(actor, 'draft.approve');
  await svc.db.transaction(async (tx) => {
    const draft = await lockDraft(tx, actor, draftId);
    if (!is(draft.status, ['approved', 'scheduled', 'queued'])) throw conflict('No hay un envío pendiente que cancelar');
    await revokePendingApproval(tx, draftId, 'Envío cancelado por el aprobador');
    await tx.update(drafts).set({ status: 'in_review', updatedAt: new Date() }).where(eq(drafts.id, draftId));
    await audit(tx, { orgId: actor.orgId, userId: actor.userId, action: 'publication.cancelled', entity: 'draft', entityId: draftId });
  });
}

/**
 * Resolución manual de un envío incierto: el aprobador comprobó la cuenta.
 * - published: se registra como publicado (con el enlace si lo tiene).
 * - not_published: se vuelve a encolar la MISMA publicación (misma clave de idempotencia).
 */
export async function resolveUnconfirmed(
  svc: Services,
  actor: Actor,
  draftId: string,
  outcome: 'published' | 'not_published',
  externalUrl?: string,
) {
  requireCap(actor, 'draft.approve');
  await svc.db.transaction(async (tx) => {
    const draft = await lockDraft(tx, actor, draftId);
    if (draft.status !== 'unconfirmed') throw conflict('Esta propuesta no tiene un envío incierto');
    const [pub] = await tx
      .select()
      .from(publications)
      .where(and(eq(publications.draftId, draftId), eq(publications.status, 'unconfirmed')))
      .for('update');
    if (!pub) throw conflict('No se encontró el envío incierto');
    if (outcome === 'published') {
      const url = externalUrl && /^https:\/\//.test(externalUrl) ? externalUrl : null;
      await tx
        .update(publications)
        .set({ status: 'published', externalUrl: url, publishedAt: new Date(), lockedAt: null, updatedAt: new Date() })
        .where(eq(publications.id, pub.id));
      await tx.update(drafts).set({ status: 'published', updatedAt: new Date() }).where(eq(drafts.id, draftId));
    } else {
      await tx
        .update(publications)
        .set({ status: 'queued', runAt: new Date(), lockedAt: null, updatedAt: new Date() })
        .where(eq(publications.id, pub.id));
      await tx.update(drafts).set({ status: 'queued', updatedAt: new Date() }).where(eq(drafts.id, draftId));
    }
    await audit(tx, { orgId: actor.orgId, userId: actor.userId, action: 'publication.resolved_manually', entity: 'publication', entityId: pub.id, data: { outcome } });
  });
}
