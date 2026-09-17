'use server';

import { redirect } from 'next/navigation';
import { approvalsModule, draftsModule } from '@radar/core';
import { requireContextForOrg, safeNext, services, userMessage, withMessage } from '@/lib/server';

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : '';
};

/** Resuelve actor para la propuesta y ejecuta la operación; siempre vuelve a `back` con un mensaje. */
async function run(fd: FormData, okMessage: string, op: (draftId: string, ctx: Awaited<ReturnType<typeof requireContextForOrg>>) => Promise<unknown>) {
  const draftId = str(fd, 'draftId');
  const back = safeNext(str(fd, 'back'), `/m/drafts/${draftId}`);
  const svc = services();
  const ctx = await requireContextForOrg(back, await draftsModule.draftOrgId(svc.db, draftId));
  let target: string;
  try {
    await op(draftId, ctx);
    target = withMessage(back, 'ok', okMessage);
  } catch (e) {
    target = withMessage(back, 'error', userMessage(e));
  }
  redirect(target);
}

export async function approveNowAction(fd: FormData) {
  await run(fd, 'Aprobado.', (draftId, ctx) =>
    approvalsModule.approveAndPublish(services(), ctx.actor, { draftId, versionId: str(fd, 'versionId') }),
  );
}

export async function scheduleAction(fd: FormData) {
  await run(fd, 'Aprobado y programado.', (draftId, ctx) =>
    approvalsModule.approveAndPublish(services(), ctx.actor, {
      draftId,
      versionId: str(fd, 'versionId'),
      scheduleLocal: str(fd, 'scheduleLocal') || 'invalid',
    }),
  );
}

export async function cancelScheduledAction(fd: FormData) {
  await run(fd, 'Envío cancelado. La propuesta volvió a revisión.', (draftId, ctx) =>
    approvalsModule.cancelScheduled(services(), ctx.actor, draftId),
  );
}

export async function discardAction(fd: FormData) {
  await run(fd, 'Propuesta descartada.', (draftId, ctx) => draftsModule.discardDraft(services(), ctx.actor, draftId));
}

export async function rejectAction(fd: FormData) {
  await run(fd, 'Propuesta rechazada.', (draftId, ctx) =>
    draftsModule.rejectDraft(services(), ctx.actor, draftId, str(fd, 'reason') || undefined),
  );
}

export async function editAction(fd: FormData) {
  await run(fd, 'Cambios guardados como nueva versión.', (draftId, ctx) =>
    draftsModule.editDraft(services(), ctx.actor, draftId, {
      expectedVersionId: str(fd, 'versionId'),
      text: str(fd, 'text'),
      socialAccountId: str(fd, 'socialAccountId') || undefined,
    }),
  );
}

export async function resolveUnconfirmedAction(fd: FormData) {
  const outcome = str(fd, 'outcome') === 'published' ? 'published' : 'not_published';
  await run(fd, outcome === 'published' ? 'Marcado como publicado.' : 'Se reintentará el envío.', (draftId, ctx) =>
    approvalsModule.resolveUnconfirmed(services(), ctx.actor, draftId, outcome, str(fd, 'externalUrl') || undefined),
  );
}

export async function generateAction(fd: FormData) {
  const brandId = str(fd, 'brandId');
  const eventId = str(fd, 'eventId');
  const back = safeNext(str(fd, 'back'), `/events/${eventId}`);
  const ctx = await requireContextForOrg(back, null);
  let target: string;
  try {
    const { draftId } = await draftsModule.createDraftFromEvent(services(), ctx.actor, {
      brandId,
      eventId,
      mode: (str(fd, 'mode') || 'informative') as never,
      angle: str(fd, 'angle') || undefined,
    });
    target = withMessage(`/drafts/${draftId}`, 'ok', 'Borrador listo. Se avisó a los aprobadores con Telegram vinculado.');
  } catch (e) {
    target = withMessage(back, 'error', userMessage(e));
  }
  redirect(target);
}
