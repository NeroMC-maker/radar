import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { jobs } from '../db/schema';

export type JobKind = 'notify_draft_ready' | 'notify_publication_result' | 'refresh_recommendations';

/** Encola un trabajo. Con dedupeKey, repetir la llamada no crea duplicados. */
export async function enqueueJob(
  db: DbOrTx,
  job: { kind: JobKind; payload: Record<string, unknown>; orgId?: string | null; runAt?: Date; dedupeKey?: string },
) {
  await db
    .insert(jobs)
    .values({
      kind: job.kind,
      payload: job.payload,
      orgId: job.orgId ?? null,
      runAt: job.runAt ?? new Date(),
      dedupeKey: job.dedupeKey,
    })
    .onConflictDoNothing();
}

export type ClaimedJob = typeof jobs.$inferSelect;

/** Toma un trabajo vencido con bloqueo exclusivo (varios workers pueden convivir). */
export async function claimJob(db: DbOrTx, workerId: string): Promise<ClaimedJob | null> {
  const res = await db.execute(sql`
    update jobs set status = 'running', locked_at = now(), locked_by = ${workerId},
      attempts = attempts + 1, updated_at = now()
    where id = (
      select id from jobs
      where status = 'pending' and run_at <= now()
      order by run_at
      for update skip locked
      limit 1
    )
    returning id`);
  const id = (res.rows[0] as { id: string } | undefined)?.id;
  if (!id) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  return job ?? null;
}

export async function completeJob(db: DbOrTx, id: string) {
  await db.update(jobs).set({ status: 'done', lockedAt: null, updatedAt: new Date() }).where(eq(jobs.id, id));
}

/** Pospone sin contar como fallo (p. ej. horario silencioso). */
export async function rescheduleJob(db: DbOrTx, id: string, runAt: Date) {
  await db
    .update(jobs)
    .set({ status: 'pending', runAt, lockedAt: null, attempts: sql`greatest(${jobs.attempts} - 1, 0)`, updatedAt: new Date() })
    .where(eq(jobs.id, id));
}

/** Reintento con espera progresiva; tras maxAttempts queda en failed. */
export async function failJob(db: DbOrTx, job: ClaimedJob, error: string, retryable = true) {
  const exhausted = !retryable || job.attempts >= job.maxAttempts;
  const backoffMs = Math.min(30 * 60_000, 2 ** job.attempts * 15_000);
  await db
    .update(jobs)
    .set({
      status: exhausted ? 'failed' : 'pending',
      runAt: exhausted ? job.runAt : new Date(Date.now() + backoffMs),
      lastError: error.slice(0, 2000),
      lockedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, job.id));
}

/** Trabajos que quedaron "running" por un reinicio: vuelven a la cola. */
export async function recoverStaleJobs(db: DbOrTx, olderThanMs = 5 * 60_000) {
  await db
    .update(jobs)
    .set({ status: 'pending', lockedAt: null, updatedAt: new Date() })
    .where(and(eq(jobs.status, 'running'), sql`${jobs.lockedAt} < now() - make_interval(secs => ${olderThanMs / 1000})`));
}

export async function jobCounts(db: DbOrTx) {
  const rows = await db
    .select({ status: jobs.status, n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(inArray(jobs.status, ['pending', 'running', 'failed']))
    .groupBy(jobs.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}
