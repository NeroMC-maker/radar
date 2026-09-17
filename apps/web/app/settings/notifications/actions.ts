'use server';

import { redirect } from 'next/navigation';
import { notificationsModule } from '@radar/core';
import { requireContext, services, userMessage, withMessage } from '@/lib/server';

const PATH = '/settings/notifications';
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : '';
};

async function run(ok: string, op: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<unknown>, extra = '') {
  const ctx = await requireContext(PATH);
  let target: string;
  try {
    await op(ctx);
    target = withMessage(PATH + extra, 'ok', ok);
  } catch (e) {
    target = withMessage(PATH, 'error', userMessage(e));
  }
  redirect(target);
}

export async function startLinkAction() {
  await run('Código generado. Ábrelo desde tu iPhone.', (ctx) => notificationsModule.startTelegramLink(services(), ctx.actor), '?linking=1');
}

export async function simulateLinkAction() {
  await run('Teléfono vinculado en modo simulado.', (ctx) => notificationsModule.simulateTelegramLink(services(), ctx.actor));
}

export async function disconnectAction() {
  await run('Telegram desconectado.', (ctx) => notificationsModule.disconnectTelegram(services(), ctx.actor));
}

export async function savePrefsAction(fd: FormData) {
  await run('Preferencias guardadas.', (ctx) =>
    notificationsModule.updatePreferences(services(), ctx.actor, {
      enabled: fd.get('enabled') === 'on',
      quietStart: str(fd, 'quietStart'),
      quietEnd: str(fd, 'quietEnd'),
      timezone: str(fd, 'timezone'),
      dailyLimit: str(fd, 'dailyLimit'),
    }),
  );
}
