import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db/client';
import {
  brands,
  drafts,
  eventSignals,
  events,
  evidenceVersions,
  feedback,
  recommendations,
  signalMeasurements,
  signals,
  sources,
  trendEvaluations,
} from '../db/schema';
import { computeAffinity, computePriority, computeTrend, type SignalObservation } from '../domain/trend';
import { notFound } from '../errors';
import { getBrand } from './brands';
import { requireCap, type Actor } from './identity';

/** Medianas de engagement por plataforma usadas para normalizar (se recalibran en la fase 2). */
export const PLATFORM_BASELINES: Record<string, number> = { hackernews: 80, github: 150, rss: 20, x: 200, reddit: 120 };

const SOURCE_AUTHORITY: Record<string, number> = { hackernews: 0.7, github: 0.6, rss: 0.6, x: 0.5, reddit: 0.5 };

async function loadEventSignals(db: DbOrTx, eventIds: string[]) {
  if (eventIds.length === 0) return new Map<string, (typeof signals.$inferSelect & { measurements: { observedAt: Date; metrics: Record<string, number> }[] })[]>();
  const rows = await db
    .select({ eventId: eventSignals.eventId, signal: signals })
    .from(eventSignals)
    .innerJoin(signals, eq(signals.id, eventSignals.signalId))
    // Solo la capa compartida: las señales privadas de otra organización nunca entran aquí.
    .where(and(inArray(eventSignals.eventId, eventIds)));
  const signalIds = rows.map((r) => r.signal.id);
  const measurements = signalIds.length
    ? await db.select().from(signalMeasurements).where(inArray(signalMeasurements.signalId, signalIds))
    : [];
  const bySignal = new Map<string, { observedAt: Date; metrics: Record<string, number> }[]>();
  for (const m of measurements) {
    const list = bySignal.get(m.signalId) ?? [];
    list.push({ observedAt: m.observedAt, metrics: m.metrics });
    bySignal.set(m.signalId, list);
  }
  const out = new Map<string, (typeof signals.$inferSelect & { measurements: { observedAt: Date; metrics: Record<string, number> }[] })[]>();
  for (const r of rows) {
    const list = out.get(r.eventId) ?? [];
    list.push({ ...r.signal, measurements: bySignal.get(r.signal.id) ?? [] });
    out.set(r.eventId, list);
  }
  return out;
}

/** Salud de recolección de las plataformas implicadas (1 = todas al día). */
async function collectionHealth(db: DbOrTx, platforms: string[], isDemo: boolean, now: Date): Promise<number> {
  if (isDemo) return 1;
  const rows = await db.select().from(sources).where(inArray(sources.kind, platforms.length ? platforms : ['-']));
  if (rows.length === 0) return 0.5;
  const healthy = rows.filter(
    (s) =>
      s.enabled &&
      s.lastSuccessAt &&
      now.getTime() - s.lastSuccessAt.getTime() < s.intervalMinutes * 3 * 60_000 &&
      (!s.lastErrorAt || s.lastErrorAt < s.lastSuccessAt),
  ).length;
  return healthy / rows.length;
}

/** Recalcula tendencias y recomendaciones de una marca. Operación del sistema (worker). */
export async function refreshRecommendations(db: Db, brandId: string, now = new Date()) {
  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
  if (!brand) return { updated: 0, excluded: 0 };

  const evs = await db.select().from(events).where(eq(events.isDemo, true)).limit(200);
  // En la fase 2 también se incluirán los acontecimientos reales activos.
  const signalMap = await loadEventSignals(
    db,
    evs.map((e) => e.id),
  );

  const referentHandles = brand.referents.map((r) => `${r.platform}:${r.handle}`);
  const fbRows = await db
    .select({ useful: feedback.useful, topics: events.topics })
    .from(feedback)
    .innerJoin(recommendations, eq(recommendations.id, feedback.recommendationId))
    .innerJoin(events, eq(events.id, recommendations.eventId))
    .where(eq(feedback.brandId, brand.id));
  const feedbackByTopic: Record<string, [number, number]> = {};
  for (const r of fbRows) {
    for (const t of r.topics) {
      const cur = feedbackByTopic[t] ?? [0, 0];
      feedbackByTopic[t] = [cur[0] + (r.useful ? 1 : 0), cur[1] + 1];
    }
  }

  const covered = await db
    .select({ eventId: drafts.eventId })
    .from(drafts)
    .where(and(eq(drafts.brandId, brand.id), notInArray(drafts.status, ['cancelled', 'rejected'])));
  const coveredSet = new Set(covered.map((c) => c.eventId));

  let updated = 0;
  let excluded = 0;
  for (const ev of evs) {
    const sigs = signalMap.get(ev.id) ?? [];
    const observations: SignalObservation[] = sigs.map((s) => ({
      platform: s.platform,
      author: s.author,
      firstSeenAt: s.publishedAt ?? s.discoveredAt,
      authority: SOURCE_AUTHORITY[s.platform] ?? null,
      measurements: s.measurements,
    }));
    const trend = computeTrend({
      now,
      eventFirstSeenAt: ev.firstSeenAt,
      signals: observations,
      referentHandles,
      platformBaselines: PLATFORM_BASELINES,
      collectionHealth: await collectionHealth(db, [...new Set(sigs.map((s) => s.platform))], ev.isDemo, now),
    });

    const affinity = computeAffinity(
      {
        interests: brand.interests,
        exclusions: brand.exclusions,
        audience: brand.audience,
        offering: brand.offering,
        language: brand.language,
        market: brand.market,
        referentHandles,
        feedbackByTopic,
      },
      {
        title: ev.title,
        summary: ev.summary,
        topics: ev.topics,
        language: ev.language,
        participantHandles: sigs.filter((s) => s.author).map((s) => `${s.platform}:${s.author}`),
      },
    );

    // Las exclusiones se aplican antes de ordenar: la recomendación desaparece.
    if (affinity.excluded) {
      await db
        .delete(recommendations)
        .where(and(eq(recommendations.brandId, brand.id), eq(recommendations.eventId, ev.id), eq(recommendations.status, 'open')));
      excluded++;
      continue;
    }

    const [evaluation] = await db
      .insert(trendEvaluations)
      .values({
        eventId: ev.id,
        weightsVersion: trend.weightsVersion,
        strength: trend.strength,
        confidence: trend.confidence,
        direction: trend.direction,
        factors: trend.factors,
        computedAt: now,
      })
      .returning();

    const ageHours = (now.getTime() - ev.firstSeenAt.getTime()) / 3_600_000;
    const priority = computePriority({
      strength: trend.strength,
      affinity: affinity.affinity,
      confidence: trend.confidence,
      ageHours,
      alreadyCovered: coveredSet.has(ev.id),
    });

    const why = Object.values(affinity.factors)
      .filter((f) => f.value >= 0.5)
      .map((f) => f.detail)
      .join(' · ');

    await db
      .insert(recommendations)
      .values({
        orgId: brand.orgId,
        brandId: brand.id,
        eventId: ev.id,
        trendEvaluationId: evaluation!.id,
        affinity: affinity.affinity,
        priority: priority.priority,
        factors: { affinity: affinity.factors, priority: priority.factors },
        whyItMatters: why || 'Relación débil con tu marca: revisa si encaja antes de publicar.',
      })
      .onConflictDoUpdate({
        target: [recommendations.brandId, recommendations.eventId],
        set: {
          trendEvaluationId: evaluation!.id,
          affinity: affinity.affinity,
          priority: priority.priority,
          factors: { affinity: affinity.factors, priority: priority.factors },
          whyItMatters: why || 'Relación débil con tu marca: revisa si encaja antes de publicar.',
          updatedAt: now,
        },
      });
    updated++;
  }
  return { updated, excluded };
}

export type RadarItem = Awaited<ReturnType<typeof listRadar>>['publishToday'][number];

export async function listRadar(db: DbOrTx, actor: Actor, brandId: string) {
  requireCap(actor, 'research.read');
  await getBrand(db, actor, brandId);
  const rows = await db
    .select({ rec: recommendations, event: events, trend: trendEvaluations })
    .from(recommendations)
    .innerJoin(events, eq(events.id, recommendations.eventId))
    .leftJoin(trendEvaluations, eq(trendEvaluations.id, recommendations.trendEvaluationId))
    .where(
      and(
        eq(recommendations.orgId, actor.orgId),
        eq(recommendations.brandId, brandId),
        notInArray(recommendations.status, ['dismissed']),
      ),
    )
    .orderBy(desc(recommendations.priority));

  const items = rows.map((r) => ({
    recommendationId: r.rec.id,
    eventId: r.event.id,
    title: r.event.title,
    summary: r.event.summary,
    isDemo: r.event.isDemo,
    topics: r.event.topics,
    priority: r.rec.priority,
    affinity: r.rec.affinity,
    strength: r.trend?.strength ?? null,
    confidence: r.trend?.confidence ?? null,
    direction: (r.trend?.direction ?? 'unknown') as 'rising' | 'stable' | 'fading' | 'unknown',
    whyItMatters: r.rec.whyItMatters,
    status: r.rec.status,
  }));

  return {
    publishToday: items.filter((i) => i.priority >= 55 && (i.direction === 'rising' || i.direction === 'stable')),
    watch: items.filter((i) => !(i.priority >= 55 && (i.direction === 'rising' || i.direction === 'stable')) && i.direction !== 'fading'),
    fading: items.filter((i) => i.direction === 'fading'),
  };
}

export async function getEventDetail(db: DbOrTx, actor: Actor, brandId: string, eventId: string) {
  requireCap(actor, 'research.read');
  await getBrand(db, actor, brandId);
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event) throw notFound('Acontecimiento no encontrado');
  const [evidence] = await db
    .select()
    .from(evidenceVersions)
    .where(eq(evidenceVersions.eventId, eventId))
    .orderBy(desc(evidenceVersions.version))
    .limit(1);
  const sigMap = await loadEventSignals(db, [eventId]);
  const [rec] = await db
    .select()
    .from(recommendations)
    .where(and(eq(recommendations.eventId, eventId), eq(recommendations.brandId, brandId), eq(recommendations.orgId, actor.orgId)));
  const trend = rec?.trendEvaluationId
    ? (await db.select().from(trendEvaluations).where(eq(trendEvaluations.id, rec.trendEvaluationId)))[0]
    : undefined;
  const history = await db
    .select({ at: trendEvaluations.computedAt, strength: trendEvaluations.strength })
    .from(trendEvaluations)
    .where(eq(trendEvaluations.eventId, eventId))
    .orderBy(desc(trendEvaluations.computedAt))
    .limit(20);
  const brandDrafts = await db
    .select({ id: drafts.id, status: drafts.status, createdAt: drafts.createdAt })
    .from(drafts)
    .where(and(eq(drafts.eventId, eventId), eq(drafts.brandId, brandId), eq(drafts.orgId, actor.orgId)))
    .orderBy(desc(drafts.createdAt));

  return {
    event,
    evidence: evidence ?? null,
    signals: (sigMap.get(eventId) ?? []).map((s) => ({
      id: s.id,
      platform: s.platform,
      title: s.title,
      url: s.url,
      author: s.author,
      publishedAt: s.publishedAt,
      latestMetrics: s.measurements.sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())[0]?.metrics ?? null,
    })),
    recommendation: rec ?? null,
    trend: trend ?? null,
    history: history.reverse(),
    drafts: brandDrafts,
  };
}

export async function dismissRecommendation(db: Db, actor: Actor, recommendationId: string, reason?: string) {
  requireCap(actor, 'feedback.create');
  await db.transaction(async (tx) => {
    const [rec] = await tx
      .update(recommendations)
      .set({ status: 'dismissed', updatedAt: new Date() })
      .where(and(eq(recommendations.id, recommendationId), eq(recommendations.orgId, actor.orgId)))
      .returning();
    if (!rec) throw notFound();
    await tx.insert(feedback).values({
      orgId: actor.orgId,
      brandId: rec.brandId,
      recommendationId: rec.id,
      userId: actor.userId,
      useful: false,
      reason: reason?.slice(0, 500) ?? 'descartada',
    });
  });
}

export async function recordFeedback(db: Db, actor: Actor, recommendationId: string, useful: boolean, reason?: string) {
  requireCap(actor, 'feedback.create');
  const [rec] = await db
    .select()
    .from(recommendations)
    .where(and(eq(recommendations.id, recommendationId), eq(recommendations.orgId, actor.orgId)));
  if (!rec) throw notFound();
  await db.insert(feedback).values({
    orgId: actor.orgId,
    brandId: rec.brandId,
    recommendationId: rec.id,
    userId: actor.userId,
    useful,
    reason: reason?.slice(0, 500),
  });
}
