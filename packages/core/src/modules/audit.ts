import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { auditLog, usageEvents } from '../db/schema';
import { AppError } from '../errors';

export async function audit(
  db: DbOrTx,
  e: { orgId: string | null; userId?: string | null; action: string; entity: string; entityId?: string; data?: Record<string, unknown> },
) {
  await db.insert(auditLog).values({
    orgId: e.orgId,
    userId: e.userId ?? null,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId,
    data: e.data ?? {},
  });
}

export async function recordUsage(
  db: DbOrTx,
  e: { orgId: string | null; kind: string; units?: number; costUsd?: number; meta?: Record<string, unknown> },
) {
  await db.insert(usageEvents).values({
    orgId: e.orgId,
    kind: e.kind,
    units: e.units ?? 1,
    costUsd: e.costUsd ?? 0,
    meta: e.meta ?? {},
  });
}

export async function spentLast24h(db: DbOrTx, orgId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)` })
    .from(usageEvents)
    .where(and(eq(usageEvents.orgId, orgId), gte(usageEvents.createdAt, new Date(Date.now() - 86_400_000))));
  return Number(row?.total ?? 0);
}

/** Se comprueba ANTES de ejecutar una operación con coste. */
export async function assertBudget(db: DbOrTx, orgId: string, estimatedCostUsd: number, dailyBudgetUsd: number) {
  const spent = await spentLast24h(db, orgId);
  if (spent + estimatedCostUsd > dailyBudgetUsd) {
    throw new AppError(
      'budget_exceeded',
      `Se alcanzó el presupuesto diario (${dailyBudgetUsd} USD; usado ${spent.toFixed(2)} USD). La operación se detuvo.`,
    );
  }
}

export async function recentAudit(db: DbOrTx, orgId: string, limit = 50) {
  return db.select().from(auditLog).where(eq(auditLog.orgId, orgId)).orderBy(desc(auditLog.createdAt)).limit(limit);
}
