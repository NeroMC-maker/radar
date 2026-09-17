import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { approvals, draftVersions, drafts, publicationAttempts, publications, socialAccounts } from '../db/schema';
import type { PublishRequest } from '../integrations/publisher/types';
import type { Services } from '../services';
import { audit, recordUsage } from './audit';
import { enqueueJob } from './jobs';

type Publication = typeof publications.$inferSelect;

const STALE_MS = 5 * 60_000;

async function setDraftStatus(tx: DbOrTx, draftId: string, status: string) {
  await tx.update(drafts).set({ status, updatedAt: new Date() }).where(eq(drafts.id, draftId));
}

async function notifyResult(tx: DbOrTx, pub: Publication, kind: string) {
  await enqueueJob(tx, {
    kind: 'notify_publication_result',
    orgId: pub.orgId,
    payload: { publicationId: pub.id, kind },
    dedupeKey: `pub_result:${pub.id}:${kind}:${pub.attempts}`,
  });
}

/**
 * Toma la siguiente publicación vencida. Bloquea publicación y borrador sin esperar:
 * si alguien está editando el borrador, se reintenta en la próxima vuelta (evita interbloqueos).
 */
async function claim(svc: Services, workerId: string) {
  return svc.db.transaction(async (tx) => {
    const [pub] = await tx
      .select()
      .from(publications)
      .where(and(inArray(publications.status, ['queued', 'scheduled']), sql`${publications.runAt} <= now()`))
      .orderBy(publications.runAt)
      .limit(1)
      .for('update', { skipLocked: true });
    if (!pub) return null;
    const [draft] = await tx.select().from(drafts).where(eq(drafts.id, pub.draftId)).for('update', { skipLocked: true });
    if (!draft) return { skipped: true as const };

    const [approval] = await tx.select().from(approvals).where(eq(approvals.id, pub.approvalId));
    const [version] = await tx.select().from(draftVersions).where(eq(draftVersions.id, pub.draftVersionId));
    const [account] = await tx.select().from(socialAccounts).where(eq(socialAccounts.id, pub.socialAccountId));

    // Defensa en profundidad: solo se envía la versión y cuenta exactas que se aprobaron.
    const stillValid =
      approval &&
      !approval.invalidatedAt &&
      version &&
      account &&
      draft.currentVersionId === pub.draftVersionId &&
      draft.socialAccountId === pub.socialAccountId &&
      version.contentHash === approval.contentHash;
    if (!stillValid) {
      await tx
        .update(publications)
        .set({ status: 'cancelled', lastError: 'La aprobación ya no corresponde al contenido actual', updatedAt: new Date() })
        .where(eq(publications.id, pub.id));
      if (draft.status === 'queued' || draft.status === 'scheduled') await setDraftStatus(tx, draft.id, 'needs_review');
      return { skipped: true as const };
    }

    // La publicación real exige cuenta real habilitada por el propietario y un publicador real.
    if (account.mode === 'live' && (!account.liveEnabled || !svc.publisher.live)) {
      await tx
        .update(publications)
        .set({ status: 'failed', lastError: 'Publicación real no habilitada', updatedAt: new Date() })
        .where(eq(publications.id, pub.id));
      await setDraftStatus(tx, draft.id, 'failed');
      return { skipped: true as const };
    }

    const [claimed] = await tx
      .update(publications)
      .set({
        status: 'publishing',
        attempts: pub.attempts + 1,
        lockedAt: new Date(),
        lockedBy: workerId,
        updatedAt: new Date(),
      })
      .where(eq(publications.id, pub.id))
      .returning();
    await setDraftStatus(tx, draft.id, 'publishing');
    const [attempt] = await tx
      .insert(publicationAttempts)
      .values({ publicationId: pub.id, attempt: claimed!.attempts })
      .returning();

    const req: PublishRequest = {
      idempotencyKey: pub.idempotencyKey,
      account: { platform: account.platform, handle: account.handle, credentialsRef: account.credentialsRef },
      text: version.text,
      assets: version.assets,
    };
    return { skipped: false as const, pub: claimed!, attemptId: attempt!.id, req };
  });
}

async function markPublished(
  svc: Services,
  pub: Publication,
  attemptId: string,
  result: { externalId: string; externalUrl: string },
  outcome: 'success' | 'verified_published',
  raw?: Record<string, unknown>,
) {
  await svc.db.transaction(async (tx) => {
    const [updated] = await tx
      .update(publications)
      .set({
        status: 'published',
        externalId: result.externalId,
        externalUrl: result.externalUrl,
        publishedAt: new Date(),
        lockedAt: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(publications.id, pub.id))
      .returning();
    await tx
      .update(publicationAttempts)
      .set({ outcome, finishedAt: new Date(), providerResponse: { ...result, ...raw } })
      .where(eq(publicationAttempts.id, attemptId));
    await setDraftStatus(tx, pub.draftId, 'published');
    await recordUsage(tx, { orgId: pub.orgId, kind: 'publication', meta: { live: svc.publisher.live } });
    await audit(tx, { orgId: pub.orgId, action: 'publication.published', entity: 'publication', entityId: pub.id, data: { externalUrl: result.externalUrl, simulated: !svc.publisher.live } });
    await notifyResult(tx, updated!, 'published');
  });
}

async function markRetryOrFailed(svc: Services, pub: Publication, attemptId: string, error: string, retryable: boolean, outcome: string) {
  await svc.db.transaction(async (tx) => {
    const exhausted = !retryable || pub.attempts >= pub.maxAttempts;
    const backoffMs = Math.min(30 * 60_000, 2 ** pub.attempts * 30_000);
    const [updated] = await tx
      .update(publications)
      .set({
        status: exhausted ? 'failed' : 'queued',
        runAt: exhausted ? pub.runAt : new Date(Date.now() + backoffMs),
        lastError: error.slice(0, 2000),
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(publications.id, pub.id))
      .returning();
    await tx
      .update(publicationAttempts)
      .set({ outcome, finishedAt: new Date(), providerResponse: { error } })
      .where(eq(publicationAttempts.id, attemptId));
    await setDraftStatus(tx, pub.draftId, exhausted ? 'failed' : 'queued');
    await audit(tx, { orgId: pub.orgId, action: exhausted ? 'publication.failed' : 'publication.retry_scheduled', entity: 'publication', entityId: pub.id, data: { error } });
    if (exhausted) await notifyResult(tx, updated!, 'failed');
  });
}

async function markUnconfirmed(svc: Services, pub: Publication, attemptId: string | null, reason: string) {
  await svc.db.transaction(async (tx) => {
    const [updated] = await tx
      .update(publications)
      .set({ status: 'unconfirmed', lastError: reason.slice(0, 2000), lockedAt: null, updatedAt: new Date() })
      .where(eq(publications.id, pub.id))
      .returning();
    if (attemptId) {
      await tx
        .update(publicationAttempts)
        .set({ outcome: 'ambiguous', finishedAt: new Date(), providerResponse: { reason } })
        .where(eq(publicationAttempts.id, attemptId));
    }
    await setDraftStatus(tx, pub.draftId, 'unconfirmed');
    await audit(tx, { orgId: pub.orgId, action: 'publication.unconfirmed', entity: 'publication', entityId: pub.id, data: { reason } });
    await notifyResult(tx, updated!, 'unconfirmed');
  });
}

/** Tras un resultado ambiguo: comprobar antes de reintentar; si no se puede, detenerse. */
async function resolveAmbiguous(svc: Services, pub: Publication, attemptId: string | null, req: PublishRequest, error: string) {
  let lookup;
  try {
    lookup = await svc.publisher.lookup(req);
  } catch (e) {
    lookup = { found: 'unknown' as const, reason: (e as Error).message };
  }
  if (lookup.found === true) {
    const id = attemptId ?? (await newAttempt(svc.db, pub));
    return markPublished(svc, pub, id, lookup, 'verified_published');
  }
  if (lookup.found === false) {
    const id = attemptId ?? (await newAttempt(svc.db, pub));
    return markRetryOrFailed(svc, pub, id, `${error} (comprobado: no se publicó)`, true, 'verified_absent');
  }
  return markUnconfirmed(svc, pub, attemptId, `${error}. No se pudo comprobar: ${lookup.reason}`);
}

async function newAttempt(db: DbOrTx, pub: Publication) {
  const [a] = await db.insert(publicationAttempts).values({ publicationId: pub.id, attempt: pub.attempts }).returning();
  return a!.id;
}

/** Procesa una publicación vencida. Devuelve false si no había trabajo. */
export async function processNextPublication(svc: Services, workerId: string): Promise<boolean> {
  const claimed = await claim(svc, workerId);
  if (!claimed) return false;
  if (claimed.skipped) return true;
  const { pub, attemptId, req } = claimed;

  const check = await svc.publisher.checkAccount(req.account).catch((e: Error) => ({ ok: false as const, error: e.message }));
  if (!check.ok) {
    await markRetryOrFailed(svc, pub, attemptId, `Credenciales o permisos: ${check.error}`, false, 'failed');
    return true;
  }

  let result;
  try {
    result = await svc.publisher.publish(req);
  } catch (e) {
    result = { outcome: 'ambiguous' as const, error: (e as Error).message };
  }

  if (result.outcome === 'success') await markPublished(svc, pub, attemptId, result, 'success', result.raw);
  else if (result.outcome === 'failed') await markRetryOrFailed(svc, pub, attemptId, result.error, result.retryable, 'failed');
  else await resolveAmbiguous(svc, pub, attemptId, req, result.error);
  return true;
}

/**
 * Publicaciones que quedaron en "publishing" por un reinicio: nunca se reenvían a ciegas.
 * Se comprueba el resultado; si no se puede, quedan como inciertas.
 */
export async function recoverStalePublications(svc: Services) {
  const stale = await svc.db
    .select({ pub: publications, version: draftVersions, account: socialAccounts })
    .from(publications)
    .innerJoin(draftVersions, eq(draftVersions.id, publications.draftVersionId))
    .innerJoin(socialAccounts, eq(socialAccounts.id, publications.socialAccountId))
    .where(and(eq(publications.status, 'publishing'), lt(publications.lockedAt, new Date(Date.now() - STALE_MS))));
  for (const { pub, version, account } of stale) {
    const req: PublishRequest = {
      idempotencyKey: pub.idempotencyKey,
      account: { platform: account.platform, handle: account.handle, credentialsRef: account.credentialsRef },
      text: version.text,
      assets: version.assets,
    };
    await resolveAmbiguous(svc, pub, null, req, 'El proceso se interrumpió durante el envío');
  }
  return stale.length;
}
