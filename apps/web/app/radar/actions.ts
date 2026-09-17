'use server';

import { redirect } from 'next/navigation';
import { radarModule } from '@radar/core';
import { requireContext, services, userMessage, withMessage } from '@/lib/server';

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : '';
};

export async function dismissAction(fd: FormData) {
  const ctx = await requireContext('/radar');
  let target: string;
  try {
    await radarModule.dismissRecommendation(services().db, ctx.actor, str(fd, 'recommendationId'));
    target = withMessage('/radar', 'ok', 'Descartada. Se tendrá en cuenta para próximas recomendaciones.');
  } catch (e) {
    target = withMessage('/radar', 'error', userMessage(e));
  }
  redirect(target);
}

export async function feedbackAction(fd: FormData) {
  const ctx = await requireContext('/radar');
  let target: string;
  try {
    await radarModule.recordFeedback(services().db, ctx.actor, str(fd, 'recommendationId'), str(fd, 'useful') === '1');
    target = withMessage('/radar', 'ok', 'Gracias, anotado.');
  } catch (e) {
    target = withMessage('/radar', 'error', userMessage(e));
  }
  redirect(target);
}
