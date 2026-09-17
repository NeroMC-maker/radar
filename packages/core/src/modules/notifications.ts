import { randomBytes } from 'node:crypto';
import { and, count, eq, gt, gte, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  brands,
  drafts,
  memberships,
  notificationRecipients,
  notifications,
  publications,
  approvals,
  socialAccounts,
} from '../db/schema';
import { NO_LONGER_NEEDS_NOTICE, is } from '../domain/draft-states';
import { can } from '../domain/roles';
import { isValidTimeZone, quietHoursEnd, startOfDayInZone } from '../domain/time';
import { notFound } from '../errors';
import type { Services } from '../services';
import { audit, recordUsage } from './audit';
import { requireCap, type Actor } from './identity';
import type { ClaimedJob } from './jobs';

type Recipient = typeof notificationRecipients.$inferSelect;

export async function getOwnRecipient(svc: Services, actor: Actor): Promise<Recipient | null> {
  requireCap(actor, 'notifications.self');
  const [r] = await svc.db
    .select()
    .from(notificationRecipients)
    .where(
      and(
        eq(notificationRecipients.orgId, actor.orgId),
        eq(notificationRecipients.userId, actor.userId),
        eq(notificationRecipients.channel, 'telegram'),
      ),
    );
  return r ?? null;
}

/** Genera un código de un solo uso (30 min) para vincular Telegram con esta cuenta. */
export async function startTelegramLink(svc: Services, actor: Actor) {
  requireCap(actor, 'notifications.self');
  const code = randomBytes(12).toString('base64url');
  const expires = new Date(Date.now() + 30 * 60_000);
  await svc.db
    .insert(notificationRecipients)
    .values({ orgId: actor.orgId, userId: actor.userId, channel: 'telegram', linkCode: code, linkCodeExpiresAt: expires })
    .onConflictDoUpdate({
      target: [notificationRecipients.orgId, notificationRecipients.userId, notificationRecipients.channel],
      set: { linkCode: code, linkCodeExpiresAt: expires },
    });
  return { code, url: await svc.notifier.linkUrl(code), live: svc.notifier.live };
}

async function completeLink(svc: Services, code: string, address: string) {
  const [r] = await svc.db
    .update(notificationRecipients)
    .set({ address, verifiedAt: new Date(), linkCode: null, linkCodeExpiresAt: null, enabled: true })
    .where(and(eq(notificationRecipients.linkCode, code), gt(notificationRecipients.linkCodeExpiresAt, new Date())))
    .returning();
  if (r) {
    await audit(svc.db, { orgId: r.orgId, userId: r.userId, action: 'notifications.linked', entity: 'recipient', entityId: r.id, data: { channel: r.channel, simulated: !svc.notifier.live } });
  }
  return r ?? null;
}

/** Worker: procesa los /start <código> recibidos por el bot. */
export async function processTelegramLinks(svc: Services) {
  const links = await svc.notifier.pollLinks();
  for (const l of links) {
    const r = await completeLink(svc, l.code, l.address);
    await svc.notifier.confirmLink(
      l.address,
      r
        ? '✅ Listo. Aquí recibirás las propuestas de Radar para aprobar y publicar.'
        : 'Ese código no es válido o caducó. Genera uno nuevo en Radar → Notificaciones.',
    );
  }
  return links.length;
}

/** Solo en modo simulado: vincula sin Telegram para probar el flujo. */
export async function simulateTelegramLink(svc: Services, actor: Actor) {
  requireCap(actor, 'notifications.self');
  if (svc.notifier.live) throw new Error('No disponible con Telegram real');
  const { code } = await startTelegramLink(svc, actor);
  await completeLink(svc, code, `sim-${actor.userId.slice(0, 8)}`);
}

export const prefsSchema = z.object({
  enabled: z.boolean(),
  quietStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .or(z.literal(''))
    .transform((v) => v || null),
  quietEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .or(z.literal(''))
    .transform((v) => v || null),
  timezone: z.string().refine(isValidTimeZone, 'Zona horaria inválida'),
  dailyLimit: z.coerce.number().int().min(1).max(100),
});

export async function updatePreferences(svc: Services, actor: Actor, raw: z.input<typeof prefsSchema>) {
  const prefs = prefsSchema.parse(raw);
  const r = await getOwnRecipient(svc, actor);
  if (!r) throw notFound('Primero conecta Telegram');
  await svc.db.update(notificationRecipients).set(prefs).where(eq(notificationRecipients.id, r.id));
}

export async function disconnectTelegram(svc: Services, actor: Actor) {
  const r = await getOwnRecipient(svc, actor);
  if (!r) return;
  await svc.db
    .update(notificationRecipients)
    .set({ address: null, verifiedAt: null, enabled: false })
    .where(eq(notificationRecipients.id, r.id));
  await audit(svc.db, { orgId: actor.orgId, userId: actor.userId, action: 'notifications.unlinked', entity: 'recipient', entityId: r.id });
}

/** Destinatarios verificados de la organización que tienen una capacidad. */
async function recipientsWith(svc: Services, orgId: string, capability: 'draft.approve') {
  const rows = await svc.db
    .select({ recipient: notificationRecipients, roles: memberships.roles })
    .from(notificationRecipients)
    .innerJoin(
      memberships,
      and(eq(memberships.orgId, notificationRecipients.orgId), eq(memberships.userId, notificationRecipients.userId)),
    )
    .where(
      and(
        eq(notificationRecipients.orgId, orgId),
        eq(notificationRecipients.enabled, true),
        isNotNull(notificationRecipients.address),
        isNotNull(notificationRecipients.verifiedAt),
      ),
    );
  return rows.filter((r) => can(r.roles, capability)).map((r) => r.recipient);
}

async function sentToday(svc: Services, r: Recipient, now: Date) {
  const [row] = await svc.db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, r.id),
        eq(notifications.status, 'accepted'),
        gte(notifications.createdAt, startOfDayInZone(now, r.timezone)),
      ),
    );
  return row?.n ?? 0;
}

type DeliveryOutcome = { reschedule?: Date; retryError?: string };

/**
 * Entrega a cada destinatario como máximo una vez (clave de deduplicación por destinatario).
 * Respeta horario silencioso y límite diario. Si el aviso no sale, la propuesta sigue en la bandeja.
 */
async function deliver(
  svc: Services,
  recipients: Recipient[],
  base: { orgId: string; draftId: string; kind: string; dedupe: string },
  message: { text: string; button?: { label: string; url: string } },
  opts: { respectQuietHours: boolean; now: Date },
): Promise<DeliveryOutcome> {
  let reschedule: Date | undefined;
  let retryError: string | undefined;
  for (const r of recipients) {
    const dedupeKey = `${base.dedupe}:${r.id}`;
    const [already] = await svc.db.select({ id: notifications.id }).from(notifications).where(eq(notifications.dedupeKey, dedupeKey));
    if (already) continue;

    if (opts.respectQuietHours) {
      const end = quietHoursEnd(opts.now, r.timezone, r.quietStart, r.quietEnd);
      if (end) {
        reschedule = !reschedule || end < reschedule ? end : reschedule;
        continue;
      }
      if ((await sentToday(svc, r, opts.now)) >= r.dailyLimit) {
        await svc.db
          .insert(notifications)
          .values({ orgId: base.orgId, recipientId: r.id, draftId: base.draftId, kind: base.kind, status: 'suppressed', dedupeKey, error: 'Límite diario alcanzado' })
          .onConflictDoNothing();
        continue;
      }
    }

    const res = await svc.notifier.send({ address: r.address!, ...message });
    if (res.status === 'failed' && res.retryable) {
      retryError = res.error;
      continue;
    }
    await svc.db
      .insert(notifications)
      .values({
        orgId: base.orgId,
        recipientId: r.id,
        draftId: base.draftId,
        kind: base.kind,
        status: res.status,
        dedupeKey,
        providerMessageId: res.status === 'accepted' ? res.providerMessageId : null,
        error: res.status === 'failed' ? res.error : null,
      })
      .onConflictDoNothing();
    await recordUsage(svc.db, { orgId: base.orgId, kind: 'notification', meta: { live: svc.notifier.live, status: res.status } });
  }
  return { reschedule, retryError };
}

const reviewUrl = (svc: Services, draftId: string) => `${svc.config.PUBLIC_BASE_URL.replace(/\/$/, '')}/m/drafts/${draftId}`;

export async function handleDraftReadyJob(svc: Services, job: ClaimedJob, now = new Date()): Promise<DeliveryOutcome> {
  const { draftId, round } = job.payload as { draftId: string; round: string };
  const [row] = await svc.db
    .select({ draft: drafts, brand: brands })
    .from(drafts)
    .innerJoin(brands, eq(brands.id, drafts.brandId))
    .where(eq(drafts.id, draftId));
  // No se avisa de propuestas ya resueltas.
  if (!row || is(row.draft.status, NO_LONGER_NEEDS_NOTICE)) return {};
  const recipients = await recipientsWith(svc, row.draft.orgId, 'draft.approve');
  return deliver(
    svc,
    recipients,
    { orgId: row.draft.orgId, draftId, kind: 'draft_ready', dedupe: `draft_ready:${draftId}:${round}` },
    {
      // Texto mínimo: se ve en la pantalla bloqueada.
      text:
        row.draft.status === 'needs_review'
          ? `Radar · Una propuesta de ${row.brand.name} necesita nueva revisión`
          : `Radar · Nueva propuesta lista para ${row.brand.name}`,
      button: { label: 'Revisar propuesta', url: reviewUrl(svc, draftId) },
    },
    { respectQuietHours: true, now },
  );
}

export async function handlePublicationResultJob(svc: Services, job: ClaimedJob, now = new Date()): Promise<DeliveryOutcome> {
  const { publicationId, kind } = job.payload as { publicationId: string; kind: 'published' | 'failed' | 'unconfirmed' };
  const [row] = await svc.db
    .select({ pub: publications, approval: approvals, account: socialAccounts })
    .from(publications)
    .innerJoin(approvals, eq(approvals.id, publications.approvalId))
    .innerJoin(socialAccounts, eq(socialAccounts.id, publications.socialAccountId))
    .where(eq(publications.id, publicationId));
  if (!row) return {};
  // El resultado se envía a quien aprobó.
  const recipients = (await recipientsWith(svc, row.pub.orgId, 'draft.approve')).filter(
    (r) => r.userId === row.approval.approvedBy,
  );
  const simulated = row.account.mode === 'simulated';
  const handle = `@${row.account.handle}`;
  const message =
    kind === 'published'
      ? {
          text: simulated
            ? `✅ Publicación SIMULADA en X (${handle}). No se envió a X.`
            : `✅ Publicado en X (${handle}).`,
          button:
            !simulated && row.pub.externalUrl
              ? { label: 'Ver publicación', url: row.pub.externalUrl }
              : { label: 'Ver resultado', url: reviewUrl(svc, row.pub.draftId) },
        }
      : kind === 'failed'
        ? { text: `⚠️ No se pudo publicar en X (${handle}).`, button: { label: 'Ver detalle', url: reviewUrl(svc, row.pub.draftId) } }
        : {
            text: `❓ No sabemos si se publicó en X (${handle}). Revísalo antes de reintentar.`,
            button: { label: 'Resolver', url: reviewUrl(svc, row.pub.draftId) },
          };
  return deliver(
    svc,
    recipients,
    { orgId: row.pub.orgId, draftId: row.pub.draftId, kind: `publication_${kind}`, dedupe: `pub_result:${publicationId}:${kind}:${row.pub.attempts}` },
    message,
    // Es la respuesta inmediata a una acción del usuario: no se retiene por horario silencioso.
    { respectQuietHours: false, now },
  );
}

export async function notificationLog(svc: Services, actor: Actor, limit = 30) {
  requireCap(actor, 'notifications.self');
  return svc.db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      status: notifications.status,
      error: notifications.error,
      createdAt: notifications.createdAt,
      draftId: notifications.draftId,
    })
    .from(notifications)
    .innerJoin(notificationRecipients, eq(notificationRecipients.id, notifications.recipientId))
    .where(and(eq(notifications.orgId, actor.orgId), eq(notificationRecipients.userId, actor.userId)))
    .orderBy(sql`${notifications.createdAt} desc`)
    .limit(limit);
}
