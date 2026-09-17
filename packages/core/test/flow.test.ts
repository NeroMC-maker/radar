import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drafts, jobs, memberships, notificationRecipients, notifications, publications, simulatedPosts } from '../src/db/schema';
import { approveAndPublish, cancelScheduled, resolveUnconfirmed } from '../src/modules/approvals';
import { assertBudget, recordUsage } from '../src/modules/audit';
import { createDraftFromEvent, editDraft, getDraftForReview, listHistory, listPending } from '../src/modules/drafts';
import { resolveActor } from '../src/modules/identity';
import { handleDraftReadyJob } from '../src/modules/notifications';
import { processNextPublication, recoverStalePublications } from '../src/modules/publications';
import { listRadar } from '../src/modules/radar';
import { processNextJob } from '../src/modules/runner';
import { createOrgWithBrand, createTestEnv, DEMO_EVENT_AI, DEMO_EVENT_BETTING, type TestEnv } from './helpers';

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});

async function drainPublications() {
  while (await processNextPublication(env, 'drain')) {
    /* vaciar publicaciones vencidas */
  }
}

async function drainJobs() {
  while (await processNextJob(env, 'test')) {
    /* vaciar cola */
  }
}

describe('recorrido móvil completo', () => {
  it('recomienda, prepara, avisa, aprueba, publica y confirma', async () => {
    const { actor, brandId } = await createOrgWithBrand(env);

    // Radar: el acontecimiento de IA aparece y el excluido no.
    const radar = await listRadar(env.db, actor, brandId);
    const all = [...radar.publishToday, ...radar.watch, ...radar.fading];
    expect(all.some((i) => i.eventId === DEMO_EVENT_AI)).toBe(true);
    expect(all.some((i) => i.eventId === DEMO_EVENT_BETTING)).toBe(false);
    const ai = all.find((i) => i.eventId === DEMO_EVENT_AI)!;
    expect(ai.whyItMatters).toMatch(/Coincide con/);

    // Borrador con voz versionada y evidencia.
    const { draftId, versionId } = await createDraftFromEvent(env, actor, { brandId, eventId: DEMO_EVENT_AI });
    const review = await getDraftForReview(env.db, actor, draftId);
    expect(review.draft.status).toBe('in_review');
    expect(review.voiceVersion).toBe(1);
    expect(review.current?.generator).toBe('simulated');
    expect(review.current!.text.length).toBeLessThanOrEqual(280);

    // Notificación con enlace a la propuesta correcta, sin el texto del post.
    env.notifier.sent.length = 0;
    await drainJobs();
    const msg = env.notifier.sent.find((m) => m.button?.url.endsWith(`/m/drafts/${draftId}`));
    expect(msg).toBeDefined();
    expect(msg!.text).not.toContain(review.current!.text.slice(0, 30));

    // Una segunda entrega del mismo trabajo no repite el aviso.
    const before = env.notifier.sent.length;
    await handleDraftReadyJob(env, { payload: { draftId, round: 'initial' } } as never);
    expect(env.notifier.sent.length).toBe(before);

    // Doble pulsación: una sola publicación.
    const [a, b] = await Promise.all([
      approveAndPublish(env, actor, { draftId, versionId }),
      approveAndPublish(env, actor, { draftId, versionId }),
    ]);
    expect(a.publicationId).toBe(b.publicationId);
    expect([a.alreadyApproved, b.alreadyApproved].sort()).toEqual([false, true]);

    // Dos workers a la vez: un solo post.
    await Promise.all([processNextPublication(env, 'w1'), processNextPublication(env, 'w2')]);
    const posts = await env.db.select().from(simulatedPosts).where(eq(simulatedPosts.idempotencyKey, `pub:${(await env.db.select().from(publications).where(eq(publications.id, a.publicationId)))[0]!.approvalId}`));
    expect(posts).toHaveLength(1);

    const history = await listHistory(env.db, actor);
    expect(history[0]!.status).toBe('published');
    expect(history[0]!.externalUrl).toMatch(/^https:\/\/x\.com\/agenciapulso\/status\/sim-/);
    expect(history[0]!.text).toBe(review.current!.text);

    // Confirmación al teléfono, marcada como simulada.
    env.notifier.sent.length = 0;
    await drainJobs();
    expect(env.notifier.sent.some((m) => /SIMULADA/.test(m.text))).toBe(true);

    // Ya resuelta: no aparece en pendientes.
    expect((await listPending(env.db, actor)).some((p) => p.id === draftId)).toBe(false);
  });
});

describe('reglas de aprobación', () => {
  it('editar después de aprobar invalida la aprobación y cancela el envío', async () => {
    const { actor, brandId } = await createOrgWithBrand(env);
    const { draftId, versionId } = await createDraftFromEvent(env, actor, { brandId, eventId: DEMO_EVENT_AI });
    const { publicationId } = await approveAndPublish(env, actor, { draftId, versionId, scheduleLocal: '2099-01-01T09:00' });

    const edit = await editDraft(env, actor, draftId, { expectedVersionId: versionId, text: 'Texto corregido' });
    expect(edit.changed).toBe(true);

    const [pub] = await env.db.select().from(publications).where(eq(publications.id, publicationId));
    expect(pub!.status).toBe('cancelled');
    const [d] = await env.db.select().from(drafts).where(eq(drafts.id, draftId));
    expect(d!.status).toBe('needs_review');

    // Aprobar la versión vieja ya no es posible.
    await expect(approveAndPublish(env, actor, { draftId, versionId })).rejects.toMatchObject({ code: 'conflict' });
    // La nueva sí.
    const again = await approveAndPublish(env, actor, { draftId, versionId: edit.versionId });
    expect(again.publicationId).not.toBe(publicationId);
    await drainPublications();
  });

  it('una publicación programada guarda un instante UTC y no sale antes de tiempo', async () => {
    const { actor, brandId } = await createOrgWithBrand(env);
    const { draftId, versionId } = await createDraftFromEvent(env, actor, { brandId, eventId: DEMO_EVENT_AI });
    const r = await approveAndPublish(env, actor, { draftId, versionId, scheduleLocal: '2099-06-01T09:00' });
    expect(r.status).toBe('scheduled');
    const [pub] = await env.db.select().from(publications).where(eq(publications.id, r.publicationId));
    expect(pub!.runAt.toISOString()).toBe('2099-06-01T14:00:00.000Z');
    expect(pub!.scheduledTimezone).toBe('America/Lima');

    // "Reinicio": otro worker cualquiera la procesa cuando vence, porque está en la base de datos.
    while (await processNextPublication(env, 'w')) {
      /* otras publicaciones vencidas */
    }
    expect((await env.db.select().from(publications).where(eq(publications.id, r.publicationId)))[0]!.status).toBe('scheduled');
    await env.db.update(publications).set({ runAt: new Date(Date.now() - 1000) }).where(eq(publications.id, r.publicationId));
    await processNextPublication(env, 'w-after-restart');
    expect((await env.db.select().from(publications).where(eq(publications.id, r.publicationId)))[0]!.status).toBe('published');
  });

  it('cancelar un programado devuelve la propuesta a revisión', async () => {
    const { actor, brandId } = await createOrgWithBrand(env);
    const { draftId, versionId } = await createDraftFromEvent(env, actor, { brandId, eventId: DEMO_EVENT_AI });
    await approveAndPublish(env, actor, { draftId, versionId, scheduleLocal: '2099-06-01T09:00' });
    await cancelScheduled(env, actor, draftId);
    const [d] = await env.db.select().from(drafts).where(eq(drafts.id, draftId));
    expect(d!.status).toBe('in_review');
  });
});

describe('permisos y aislamiento', () => {
  it('otra organización no puede ver ni aprobar una propuesta ajena', async () => {
    const a = await createOrgWithBrand(env);
    const b = await createOrgWithBrand(env);
    const { draftId, versionId } = await createDraftFromEvent(env, a.actor, { brandId: a.brandId, eventId: DEMO_EVENT_AI });

    await expect(getDraftForReview(env.db, b.actor, draftId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(approveAndPublish(env, b.actor, { draftId, versionId })).rejects.toMatchObject({ code: 'not_found' });
    await expect(listRadar(env.db, b.actor, a.brandId)).rejects.toMatchObject({ code: 'not_found' });
    // Suplantar la organización tampoco sirve: la membresía se verifica en el servidor.
    await expect(resolveActor(env.db, b.actor.userId, a.actor.orgId)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('un editor sin rol de aprobador no puede aprobar', async () => {
    const { actor, brandId } = await createOrgWithBrand(env);
    const { draftId, versionId } = await createDraftFromEvent(env, actor, { brandId, eventId: DEMO_EVENT_AI });
    await env.db.update(memberships).set({ roles: ['editor'] }).where(eq(memberships.userId, actor.userId));
    const editor = await resolveActor(env.db, actor.userId, actor.orgId);
    await expect(approveAndPublish(env, editor, { draftId, versionId })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('el presupuesto detiene operaciones antes de excederse', async () => {
    const { actor } = await createOrgWithBrand(env);
    await recordUsage(env.db, { orgId: actor.orgId, kind: 'generation', costUsd: 1.99 });
    await expect(assertBudget(env.db, actor.orgId, 0.05, 2)).rejects.toMatchObject({ code: 'budget_exceeded' });
  });
});

describe('envíos fallidos e inciertos', () => {
  async function approved() {
    await drainPublications();
    const { actor, brandId } = await createOrgWithBrand(env);
    const { draftId, versionId } = await createDraftFromEvent(env, actor, { brandId, eventId: DEMO_EVENT_AI });
    const { publicationId } = await approveAndPublish(env, actor, { draftId, versionId });
    const get = async () => (await env.db.select().from(publications).where(eq(publications.id, publicationId)))[0]!;
    return { actor, draftId, publicationId, get };
  }

  it('error temporal: reintento programado, no se marca como publicado', async () => {
    const { get } = await approved();
    env.publisher.failure = 'error';
    try {
      await processNextPublication(env, 'w');
    } finally {
      env.publisher.failure = 'none';
    }
    const pub = await get();
    expect(pub.status).toBe('queued');
    expect(pub.runAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('timeout con post creado: se comprueba y se marca publicado sin duplicar', async () => {
    const { get } = await approved();
    env.publisher.failure = 'timeout_created';
    try {
      await processNextPublication(env, 'w');
    } finally {
      env.publisher.failure = 'none';
    }
    const pub = await get();
    expect(pub.status).toBe('published');
    const posts = await env.db.select().from(simulatedPosts).where(eq(simulatedPosts.idempotencyKey, pub.idempotencyKey));
    expect(posts).toHaveLength(1);
  });

  it('timeout sin poder comprobar: queda incierto y no se reintenta solo', async () => {
    const { actor, draftId, get } = await approved();
    env.publisher.failure = 'lookup_unavailable';
    try {
      await processNextPublication(env, 'w');
      expect((await get()).status).toBe('unconfirmed');
      expect(await processNextPublication(env, 'w')).toBe(false);
    } finally {
      env.publisher.failure = 'none';
    }
    const [d] = await env.db.select().from(drafts).where(eq(drafts.id, draftId));
    expect(d!.status).toBe('unconfirmed');
    expect((await listPending(env.db, actor)).some((p) => p.id === draftId)).toBe(true);

    // El aprobador comprueba que no salió y reintenta con la misma clave.
    await resolveUnconfirmed(env, actor, draftId, 'not_published');
    await processNextPublication(env, 'w');
    expect((await get()).status).toBe('published');
  });

  it('proceso interrumpido durante el envío: se comprueba antes de reenviar', async () => {
    const { get, publicationId } = await approved();
    // Simula un worker que murió tras marcar "publishing".
    await env.db
      .update(publications)
      .set({ status: 'publishing', lockedAt: new Date(Date.now() - 10 * 60_000), attempts: 1 })
      .where(eq(publications.id, publicationId));
    await recoverStalePublications(env);
    // No había post: se vuelve a encolar (comprobado), no se marca como publicado.
    expect((await get()).status).toBe('queued');
  });
});

describe('notificaciones', () => {
  it('respeta el horario silencioso y deja la propuesta en la bandeja', async () => {
    const { actor, brandId } = await createOrgWithBrand(env);
    await env.db
      .update(notificationRecipients)
      .set({ quietStart: '00:00', quietEnd: '23:59' })
      .where(eq(notificationRecipients.userId, actor.userId));
    const { draftId } = await createDraftFromEvent(env, actor, { brandId, eventId: DEMO_EVENT_AI });
    const [job] = await env.db.select().from(jobs).where(eq(jobs.dedupeKey, `draft_ready:${draftId}:initial`));
    const out = await handleDraftReadyJob(env, job!);
    expect(out.reschedule).toBeInstanceOf(Date);
    const sent = await env.db.select().from(notifications).where(eq(notifications.draftId, draftId));
    expect(sent).toHaveLength(0);
    expect((await listPending(env.db, actor)).some((p) => p.id === draftId)).toBe(true);
  });

  it('no avisa de una propuesta que ya se resolvió', async () => {
    const { actor, brandId } = await createOrgWithBrand(env);
    const { draftId, versionId } = await createDraftFromEvent(env, actor, { brandId, eventId: DEMO_EVENT_AI });
    await approveAndPublish(env, actor, { draftId, versionId });
    const [job] = await env.db.select().from(jobs).where(eq(jobs.dedupeKey, `draft_ready:${draftId}:initial`));
    env.notifier.sent.length = 0;
    await handleDraftReadyJob(env, job!);
    expect(env.notifier.sent).toHaveLength(0);
  });
});
