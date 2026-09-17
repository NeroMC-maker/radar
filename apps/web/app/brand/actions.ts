'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { brandsModule, radarModule } from '@radar/core';
import { BRAND_COOKIE, requireContext, secureCookies, services, userMessage, withMessage } from '@/lib/server';

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : '';
};

function brandInput(fd: FormData) {
  return {
    name: str(fd, 'name'),
    description: str(fd, 'description'),
    industry: str(fd, 'industry'),
    offering: str(fd, 'offering'),
    audience: str(fd, 'audience'),
    market: str(fd, 'market'),
    language: str(fd, 'language') || 'es',
    timezone: str(fd, 'timezone') || 'America/Lima',
    goals: str(fd, 'goals'),
    positioning: str(fd, 'positioning'),
    interests: str(fd, 'interests'),
    exclusions: str(fd, 'exclusions'),
    referents: str(fd, 'referents'),
    xHandle: str(fd, 'xHandle'),
  };
}

export async function createBrandAction(fd: FormData) {
  const ctx = await requireContext('/onboarding');
  let target: string;
  try {
    const svc = services();
    const brand = await brandsModule.createBrand(svc.db, ctx.actor, brandInput(fd));
    // Cálculo inmediato para que el radar no aparezca vacío la primera vez.
    await radarModule.refreshRecommendations(svc.db, brand.id);
    (await cookies()).set(BRAND_COOKIE, brand.id, { httpOnly: true, sameSite: 'lax', secure: secureCookies(), path: '/' });
    // Siguiente paso: que la persona escriba para deducir su voz.
    target = withMessage('/brand/voice?nueva=1', 'ok', 'Marca creada. Ahora cuéntanos cómo escribes.');
  } catch (e) {
    target = withMessage('/onboarding', 'error', userMessage(e));
  }
  redirect(target);
}

export async function updateBrandAction(fd: FormData) {
  const ctx = await requireContext('/brand');
  let target: string;
  try {
    await brandsModule.updateBrand(services().db, ctx.actor, str(fd, 'brandId'), brandInput(fd));
    target = withMessage('/brand', 'ok', 'Perfil guardado. Las recomendaciones se recalculan en segundo plano.');
  } catch (e) {
    target = withMessage('/brand', 'error', userMessage(e));
  }
  redirect(target);
}

export async function saveVoiceAction(fd: FormData) {
  const ctx = await requireContext('/brand');
  let target: string;
  try {
    const v = await brandsModule.saveVoice(services().db, ctx.actor, str(fd, 'brandId'), {
      formality: str(fd, 'formality') as never,
      technicalLevel: str(fd, 'technicalLevel') as never,
      length: str(fd, 'length') as never,
      emojis: str(fd, 'emojis') as never,
      phrases: str(fd, 'phrases'),
      forbiddenWords: str(fd, 'forbiddenWords'),
      openings: str(fd, 'openings'),
      closings: str(fd, 'closings'),
      ctaPreference: str(fd, 'ctaPreference'),
      addressForm: str(fd, 'addressForm') as never,
      exclamations: str(fd, 'exclamations') as never,
      hashtags: str(fd, 'hashtags'),
    });
    target = withMessage('/brand', 'ok', `Voz guardada como versión ${v.version}.`);
  } catch (e) {
    target = withMessage('/brand', 'error', userMessage(e));
  }
  redirect(target);
}

export async function addExampleAction(fd: FormData) {
  const ctx = await requireContext('/brand');
  let target: string;
  try {
    await brandsModule.addApprovedExample(services().db, ctx.actor, str(fd, 'brandId'), str(fd, 'text'));
    target = withMessage('/brand', 'ok', 'Ejemplo añadido.');
  } catch (e) {
    target = withMessage('/brand', 'error', userMessage(e));
  }
  redirect(target);
}
