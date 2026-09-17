import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '../db/client';
import {
  approvals,
  brands,
  draftVersions,
  drafts,
  events,
  evidenceVersions,
  publications,
  recommendations,
  socialAccounts,
  voiceVersions,
} from '../db/schema';
import { contentHash } from '../domain/content-hash';
import {
  APPROVED_PENDING_SEND,
  DISCARDABLE,
  EDITABLE,
  PENDING_DECISION,
  is,
  statusAfterEdit,
  type DraftStatus,
} from '../domain/draft-states';
import { conflict, invalid, notFound } from '../errors';
import { CONTENT_MODES } from '../integrations/generator/types';
import type { Services } from '../services';
import { assertBudget, audit, recordUsage } from './audit';
import { currentVoice, getBrand, listApprovedExamples } from './brands';
import { requireCap, type Actor } from './identity';
import { enqueueJob } from './jobs';

export const X_MAX_LENGTH = 280;

export const generateSchema = z.object({
  brandId: z.string().uuid(),
  eventId: z.string().uuid(),
  mode: z.enum(CONTENT_MODES).default('informative'),
  angle: z.string().trim().max(300).optional(),
});

export async function createDraftFromEvent(
  svc: Services,
  actor: Actor,
  raw: z.input<typeof generateSchema>,
  origin: 'manual' | 'auto' = 'manual',
) {
  requireCap(actor, 'draft.create');
  const input = generateSchema.parse(raw);
  const { db } = svc;
  const brand = await getBrand(db, actor, input.brandId);
  const voice = await currentVoice(db, actor, brand.id);
  const examples = await listApprovedExamples(db, actor, brand.id);
  const [evidence] = await db
    .select()
    .from(evidenceVersions)
    .where(eq(evidenceVersions.eventId, input.eventId))
    .orderBy(desc(evidenceVersions.version))
    .limit(1);
  if (!evidence) throw invalid('Este acontecimiento todavía no tiene ficha de evidencia');
  const [event] = await db.select().from(events).where(eq(events.id, input.eventId));
  const [account] = await db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.brandId, brand.id), eq(socialAccounts.orgId, actor.orgId), eq(socialAccounts.platform, 'x')));
  if (!account) throw invalid('La marca no tiene una cuenta de X configurada');

  const recent = await db
    .select({ text: draftVersions.text })
    .from(publications)
    .innerJoin(draftVersions, eq(draftVersions.id, publications.draftVersionId))
    .innerJoin(drafts, eq(drafts.id, publications.draftId))
    .where(and(eq(drafts.brandId, brand.id), eq(publications.status, 'published')))
    .orderBy(desc(publications.publishedAt))
    .limit(5);

  // El coste se comprueba antes de llamar al generador.
  await assertBudget(db, actor.orgId, svc.generator.live ? 0.05 : 0, svc.config.DAILY_BUDGET_USD);

  const out = await svc.generator.generate({
    channel: 'x',
    mode: input.mode,
    angle: input.angle,
    brand: {
      name: brand.name,
      positioning: brand.positioning,
      audience: brand.audience,
      language: brand.language,
      goals: brand.goals,
    },
    voice: voice.traits,
    approvedExamples: examples.map((e) => e.text),
    recentPosts: recent.map((r) => r.text),
    evidence: {
      title: event?.title ?? '',
      whatHappened: evidence.whatHappened,
      confirmed: evidence.confirmed,
      uncertain: evidence.uncertain,
      sources: evidence.sources,
      insufficient: evidence.insufficient,
    },
  });

  if (out.text.length > X_MAX_LENGTH) out.reviewNotes.push(`Supera ${X_MAX_LENGTH} caracteres: acórtalo antes de aprobar.`);

  return db.transaction(async (tx) => {
    const [rec] = await tx
      .select()
      .from(recommendations)
      .where(and(eq(recommendations.brandId, brand.id), eq(recommendations.eventId, input.eventId)));
    const [draft] = await tx
      .insert(drafts)
      .values({
        orgId: actor.orgId,
        brandId: brand.id,
        eventId: input.eventId,
        recommendationId: rec?.id,
        channel: 'x',
        socialAccountId: account.id,
        status: 'in_review',
        origin,
        createdBy: actor.userId,
      })
      .returning();
    const [version] = await tx
      .insert(draftVersions)
      .values({
        orgId: actor.orgId,
        draftId: draft!.id,
        number: 1,
        text: out.text,
        references: out.references,
        angle: out.angle,
        mode: input.mode,
        reviewNotes: out.reviewNotes,
        evidenceVersionId: evidence.id,
        voiceVersionId: voice.id,
        generator: out.generator,
        contentHash: contentHash({ text: out.text, assets: [], socialAccountId: account.id }),
        createdBy: actor.userId,
      })
      .returning();
    await tx.update(drafts).set({ currentVersionId: version!.id }).where(eq(drafts.id, draft!.id));
    if (rec) await tx.update(recommendations).set({ status: 'used', updatedAt: new Date() }).where(eq(recommendations.id, rec.id));
    await recordUsage(tx, { orgId: actor.orgId, kind: 'generation', costUsd: out.costUsd, meta: { generator: out.generator } });
    await audit(tx, { orgId: actor.orgId, userId: actor.userId, action: 'draft.generated', entity: 'draft', entityId: draft!.id, data: { generator: out.generator, origin } });
    await enqueueJob(tx, {
      kind: 'notify_draft_ready',
      orgId: actor.orgId,
      payload: { draftId: draft!.id, round: 'initial' },
      dedupeKey: `draft_ready:${draft!.id}:initial`,
    });
    return { draftId: draft!.id, versionId: version!.id };
  });
}

/** Bloquea el borrador para una operación que cambia su estado. Filtra por organización. */
export async function lockDraft(tx: DbOrTx, actor: Actor, draftId: string) {
  const [draft] = await tx
    .select()
    .from(drafts)
    .where(and(eq(drafts.id, draftId), eq(drafts.orgId, actor.orgId)))
    .for('update');
  if (!draft) throw notFound('Propuesta no encontrada');
  return draft;
}

/** Invalida aprobaciones vigentes y cancela envíos que aún no empezaron. */
export async function revokePendingApproval(tx: DbOrTx, draftId: string, reason: string) {
  await tx
    .update(approvals)
    .set({ invalidatedAt: new Date(), invalidatedReason: reason })
    .where(and(eq(approvals.draftId, draftId), isNull(approvals.invalidatedAt)));
  await tx
    .update(publications)
    .set({ status: 'cancelled', lastError: reason, updatedAt: new Date() })
    .where(and(eq(publications.draftId, draftId), inArray(publications.status, ['queued', 'scheduled'])));
}

export const editSchema = z.object({
  expectedVersionId: z.string().uuid(),
  text: z.string().trim().min(1, 'El texto no puede estar vacío').max(4000),
  socialAccountId: z.string().uuid().optional(),
});

export async function editDraft(svc: Services, actor: Actor, draftId: string, raw: z.input<typeof editSchema>) {
  requireCap(actor, 'draft.edit');
  const input = editSchema.parse(raw);
  return svc.db.transaction(async (tx) => {
    const draft = await lockDraft(tx, actor, draftId);
    if (draft.currentVersionId !== input.expectedVersionId) {
      throw conflict('La propuesta cambió mientras la editabas. Recarga para ver la versión actual.');
    }
    if (!is(draft.status, EDITABLE)) throw conflict('Esta propuesta ya no se puede editar');
    const [current] = await tx.select().from(draftVersions).where(eq(draftVersions.id, draft.currentVersionId!));

    const accountId = input.socialAccountId ?? draft.socialAccountId;
    if (accountId !== draft.socialAccountId) {
      const [acc] = await tx
        .select()
        .from(socialAccounts)
        .where(and(eq(socialAccounts.id, accountId!), eq(socialAccounts.orgId, actor.orgId), eq(socialAccounts.brandId, draft.brandId)));
      if (!acc) throw invalid('Cuenta de destino no válida para esta marca');
    }
    const hash = contentHash({ text: input.text, assets: current!.assets, socialAccountId: accountId });
    if (hash === current!.contentHash) return { versionId: current!.id, changed: false };

    const [version] = await tx
      .insert(draftVersions)
      .values({
        orgId: actor.orgId,
        draftId,
        number: current!.number + 1,
        text: input.text,
        assets: current!.assets,
        references: current!.references,
        angle: current!.angle,
        mode: current!.mode,
        reviewNotes: input.text.length > X_MAX_LENGTH ? [`Supera ${X_MAX_LENGTH} caracteres.`] : [],
        evidenceVersionId: current!.evidenceVersionId,
        voiceVersionId: current!.voiceVersionId,
        generator: 'human',
        contentHash: hash,
        createdBy: actor.userId,
      })
      .returning();

    const next = statusAfterEdit(draft.status as DraftStatus);
    if (is(draft.status, APPROVED_PENDING_SEND)) {
      await revokePendingApproval(tx, draftId, 'Contenido modificado después de aprobar');
    }
    await tx
      .update(drafts)
      .set({ currentVersionId: version!.id, socialAccountId: accountId, status: next, updatedAt: new Date() })
      .where(eq(drafts.id, draftId));
    await audit(tx, {
      orgId: actor.orgId,
      userId: actor.userId,
      action: 'draft.edited',
      entity: 'draft',
      entityId: draftId,
      data: { version: version!.number, from: draft.status, to: next },
    });
    return { versionId: version!.id, changed: true };
  });
}

export async function discardDraft(svc: Services, actor: Actor, draftId: string) {
  requireCap(actor, 'draft.discard');
  await svc.db.transaction(async (tx) => {
    const draft = await lockDraft(tx, actor, draftId);
    if (!is(draft.status, DISCARDABLE)) throw conflict('Esta propuesta ya no se puede descartar');
    await revokePendingApproval(tx, draftId, 'Propuesta descartada');
    await tx.update(drafts).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(drafts.id, draftId));
    await audit(tx, { orgId: actor.orgId, userId: actor.userId, action: 'draft.discarded', entity: 'draft', entityId: draftId });
  });
}

export async function rejectDraft(svc: Services, actor: Actor, draftId: string, reason?: string) {
  requireCap(actor, 'draft.approve');
  await svc.db.transaction(async (tx) => {
    const draft = await lockDraft(tx, actor, draftId);
    if (!is(draft.status, ['draft', 'in_review', 'needs_review'])) throw conflict('Esta propuesta no está pendiente de revisión');
    await tx.update(drafts).set({ status: 'rejected', updatedAt: new Date() }).where(eq(drafts.id, draftId));
    await audit(tx, { orgId: actor.orgId, userId: actor.userId, action: 'draft.rejected', entity: 'draft', entityId: draftId, data: { reason } });
  });
}

/**
 * Una corrección material de la evidencia obliga a revisar las propuestas no publicadas que la usaban.
 * Operación del sistema (se llama al versionar evidencia).
 */
export async function flagDraftsForEvidenceChange(db: DbOrTx, eventId: string, newEvidenceVersionId: string) {
  const affected = await db
    .select({ draft: drafts, evidenceVersionId: draftVersions.evidenceVersionId })
    .from(drafts)
    .innerJoin(draftVersions, eq(draftVersions.id, drafts.currentVersionId))
    .where(
      and(
        eq(drafts.eventId, eventId),
        inArray(drafts.status, ['draft', 'in_review', ...APPROVED_PENDING_SEND]),
        ne(draftVersions.evidenceVersionId, newEvidenceVersionId),
      ),
    )
    .for('update', { of: drafts });
  for (const { draft } of affected) {
    await revokePendingApproval(db, draft.id, 'La evidencia del acontecimiento cambió');
    await db.update(drafts).set({ status: 'needs_review', updatedAt: new Date() }).where(eq(drafts.id, draft.id));
    await audit(db, { orgId: draft.orgId, action: 'draft.needs_review', entity: 'draft', entityId: draft.id, data: { evidenceVersionId: newEvidenceVersionId } });
    await enqueueJob(db, {
      kind: 'notify_draft_ready',
      orgId: draft.orgId,
      payload: { draftId: draft.id, round: `evidence:${newEvidenceVersionId}` },
      dedupeKey: `draft_ready:${draft.id}:evidence:${newEvidenceVersionId}`,
    });
  }
  return affected.length;
}

/**
 * Organización dueña de una propuesta. Solo sirve para elegir entre las membresías del propio usuario;
 * el acceso se sigue verificando con el actor.
 */
export async function draftOrgId(db: DbOrTx, draftId: string): Promise<string | null> {
  if (!z.string().uuid().safeParse(draftId).success) return null;
  const [row] = await db.select({ orgId: drafts.orgId }).from(drafts).where(eq(drafts.id, draftId));
  return row?.orgId ?? null;
}

/** Todo lo que la pantalla de revisión necesita. */
export async function getDraftForReview(db: DbOrTx, actor: Actor, draftId: string) {
  requireCap(actor, 'brand.read');
  const [row] = await db
    .select({ draft: drafts, brand: brands, account: socialAccounts, event: events })
    .from(drafts)
    .innerJoin(brands, eq(brands.id, drafts.brandId))
    .leftJoin(socialAccounts, eq(socialAccounts.id, drafts.socialAccountId))
    .leftJoin(events, eq(events.id, drafts.eventId))
    .where(and(eq(drafts.id, draftId), eq(drafts.orgId, actor.orgId)));
  if (!row) throw notFound('Propuesta no encontrada');
  const versions = await db
    .select()
    .from(draftVersions)
    .where(and(eq(draftVersions.draftId, draftId), eq(draftVersions.orgId, actor.orgId)))
    .orderBy(desc(draftVersions.number));
  const current = versions.find((v) => v.id === row.draft.currentVersionId) ?? versions[0];
  const evidence = current?.evidenceVersionId
    ? (await db.select().from(evidenceVersions).where(eq(evidenceVersions.id, current.evidenceVersionId)))[0]
    : undefined;
  const voice = current?.voiceVersionId
    ? (await db.select({ version: voiceVersions.version }).from(voiceVersions).where(eq(voiceVersions.id, current.voiceVersionId)))[0]
    : undefined;
  const rec = row.draft.recommendationId
    ? (await db.select().from(recommendations).where(eq(recommendations.id, row.draft.recommendationId)))[0]
    : undefined;
  const pubs = await db
    .select()
    .from(publications)
    .where(and(eq(publications.draftId, draftId), eq(publications.orgId, actor.orgId)))
    .orderBy(desc(publications.createdAt));
  const accounts = await db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.brandId, row.brand.id), eq(socialAccounts.orgId, actor.orgId)));

  return {
    draft: row.draft,
    brand: row.brand,
    account: row.account,
    accounts,
    event: row.event,
    current: current ?? null,
    versions,
    evidence: evidence ?? null,
    voiceVersion: voice?.version ?? null,
    recommendation: rec ?? null,
    publication: pubs[0] ?? null,
    publications: pubs,
  };
}

export async function listPending(db: DbOrTx, actor: Actor) {
  requireCap(actor, 'brand.read');
  return db
    .select({
      id: drafts.id,
      status: drafts.status,
      updatedAt: drafts.updatedAt,
      brandName: brands.name,
      text: draftVersions.text,
      eventTitle: events.title,
    })
    .from(drafts)
    .innerJoin(brands, eq(brands.id, drafts.brandId))
    .leftJoin(draftVersions, eq(draftVersions.id, drafts.currentVersionId))
    .leftJoin(events, eq(events.id, drafts.eventId))
    .where(and(eq(drafts.orgId, actor.orgId), inArray(drafts.status, [...PENDING_DECISION, 'draft'])))
    .orderBy(desc(drafts.updatedAt));
}

export async function listScheduled(db: DbOrTx, actor: Actor) {
  requireCap(actor, 'brand.read');
  return db
    .select({
      publicationId: publications.id,
      draftId: publications.draftId,
      runAt: publications.runAt,
      status: publications.status,
      timezone: publications.scheduledTimezone,
      brandName: brands.name,
      text: draftVersions.text,
    })
    .from(publications)
    .innerJoin(drafts, eq(drafts.id, publications.draftId))
    .innerJoin(brands, eq(brands.id, drafts.brandId))
    .innerJoin(draftVersions, eq(draftVersions.id, publications.draftVersionId))
    .where(and(eq(publications.orgId, actor.orgId), inArray(publications.status, ['scheduled', 'queued', 'publishing'])))
    .orderBy(publications.runAt);
}

export async function listHistory(db: DbOrTx, actor: Actor, limit = 100) {
  requireCap(actor, 'brand.read');
  return db
    .select({
      publicationId: publications.id,
      draftId: publications.draftId,
      status: publications.status,
      runAt: publications.runAt,
      publishedAt: publications.publishedAt,
      externalUrl: publications.externalUrl,
      lastError: publications.lastError,
      attempts: publications.attempts,
      brandName: brands.name,
      handle: socialAccounts.handle,
      accountMode: socialAccounts.mode,
      text: draftVersions.text,
      versionNumber: draftVersions.number,
    })
    .from(publications)
    .innerJoin(drafts, eq(drafts.id, publications.draftId))
    .innerJoin(brands, eq(brands.id, drafts.brandId))
    .innerJoin(socialAccounts, eq(socialAccounts.id, publications.socialAccountId))
    .innerJoin(draftVersions, eq(draftVersions.id, publications.draftVersionId))
    .where(eq(publications.orgId, actor.orgId))
    .orderBy(desc(publications.createdAt))
    .limit(limit);
}
