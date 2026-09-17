import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { brands, publications, usageEvents } from '../db/schema';
import { integrationStatus } from '../integrations';
import type { Services } from '../services';
import { requireCap, type Actor } from './identity';
import {
  claimJob,
  completeJob,
  failJob,
  jobCounts,
  recoverStaleJobs,
  rescheduleJob,
  type ClaimedJob,
} from './jobs';
import { handleDraftReadyJob, handlePublicationResultJob } from './notifications';
import { recoverStalePublications } from './publications';
import { refreshRecommendations } from './radar';

async function runJob(svc: Services, job: ClaimedJob) {
  switch (job.kind) {
    case 'notify_draft_ready':
      return handleDraftReadyJob(svc, job);
    case 'notify_publication_result':
      return handlePublicationResultJob(svc, job);
    case 'refresh_recommendations':
      await refreshRecommendations(svc.db, (job.payload as { brandId: string }).brandId);
      return {};
    default:
      throw new Error(`Tipo de trabajo desconocido: ${job.kind}`);
  }
}

/** Procesa un trabajo de la cola. Devuelve false si no había ninguno. */
export async function processNextJob(svc: Services, workerId: string): Promise<boolean> {
  const job = await claimJob(svc.db, workerId);
  if (!job) return false;
  try {
    const out = await runJob(svc, job);
    if (out.retryError) await failJob(svc.db, job, out.retryError);
    else if (out.reschedule) await rescheduleJob(svc.db, job.id, out.reschedule);
    else await completeJob(svc.db, job.id);
  } catch (e) {
    await failJob(svc.db, job, (e as Error).stack ?? String(e));
  }
  return true;
}

/** Recupera trabajo interrumpido por un reinicio. */
export async function recoverAfterRestart(svc: Services) {
  await recoverStaleJobs(svc.db);
  return recoverStalePublications(svc);
}

/** Recalcula periódicamente las recomendaciones de todas las marcas. */
export async function refreshAllBrands(svc: Services) {
  const all = await svc.db.select({ id: brands.id }).from(brands);
  for (const b of all) await refreshRecommendations(svc.db, b.id);
  return all.length;
}

export async function operationsStatus(svc: Services, actor: Actor) {
  requireCap(actor, 'operations.read');
  const since = new Date(Date.now() - 86_400_000);
  const usage = await svc.db
    .select({
      kind: usageEvents.kind,
      units: sql<number>`coalesce(sum(${usageEvents.units}), 0)::int`,
      cost: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.orgId, actor.orgId), gte(usageEvents.createdAt, since)))
    .groupBy(usageEvents.kind);
  const pubs = await svc.db
    .select({ status: publications.status, n: sql<number>`count(*)::int` })
    .from(publications)
    .where(and(eq(publications.orgId, actor.orgId), inArray(publications.status, ['queued', 'scheduled', 'publishing', 'failed', 'unconfirmed'])))
    .groupBy(publications.status);
  const timeToPublish = await svc.db
    .select({ avgSeconds: sql<string | null>`avg(extract(epoch from (${publications.publishedAt} - ${publications.runAt})))` })
    .from(publications)
    .where(and(eq(publications.orgId, actor.orgId), eq(publications.status, 'published'), gte(publications.publishedAt, since)));

  return {
    integrations: integrationStatus(svc.config),
    jobs: await jobCounts(svc.db),
    publications: Object.fromEntries(pubs.map((p) => [p.status, p.n])) as Record<string, number>,
    usage: usage.map((u) => ({ kind: u.kind, units: u.units, costUsd: Number(u.cost) })),
    spentUsd: usage.reduce((a, u) => a + Number(u.cost), 0),
    dailyBudgetUsd: svc.config.DAILY_BUDGET_USD,
    avgSecondsToPublish: timeToPublish[0]?.avgSeconds ? Number(timeToPublish[0].avgSeconds) : null,
  };
}
