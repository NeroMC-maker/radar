'use server';

import { redirect } from 'next/navigation';
import { brandsModule, can, inferVoice, type VoiceProposal } from '@radar/core';
import { requireContext, services, userMessage, withMessage } from '@/lib/server';

const PATH = '/brand/voice';
const MAX_SAMPLES = 10;
const MIN_CHARS = 30;

export type AnalyzeState =
  | { status: 'idle' }
  | { status: 'error'; message: string; samples: string[] }
  | { status: 'proposal'; proposal: VoiceProposal; samples: string[] };

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : '';
};

/** Recoge los textos de los ejercicios y de "pega tus publicaciones" (separadas por una línea con ---). */
function collectSamples(fd: FormData): string[] {
  const exercises = fd.getAll('sample').filter((v): v is string => typeof v === 'string');
  const pasted = str(fd, 'pasted')
    .split(/^\s*-{3,}\s*$/m)
    .map((s) => s.trim());
  return [...exercises, ...pasted]
    .map((s) => s.trim().slice(0, 2000))
    .filter(Boolean)
    .slice(0, MAX_SAMPLES);
}

export async function analyzeVoiceAction(_prev: AnalyzeState, fd: FormData): Promise<AnalyzeState> {
  const ctx = await requireContext(PATH);
  const samples = collectSamples(fd);
  if (!can(ctx.actor.roles, 'brand.configure')) {
    return { status: 'error', message: 'Solo el propietario puede configurar la voz de la marca.', samples };
  }
  const valid = samples.filter((s) => s.length >= MIN_CHARS);
  if (valid.length < 2) {
    return {
      status: 'error',
      message: `Escribe al menos 2 textos de ${MIN_CHARS} caracteres o más para poder reconocer tu estilo.`,
      samples,
    };
  }
  return { status: 'proposal', proposal: inferVoice(valid), samples: valid };
}

export async function confirmVoiceAction(fd: FormData) {
  const ctx = await requireContext(PATH);
  let target: string;
  try {
    let samples: string[] = [];
    try {
      const parsed: unknown = JSON.parse(str(fd, 'samples') || '[]');
      if (Array.isArray(parsed)) samples = parsed.filter((s): s is string => typeof s === 'string');
    } catch {
      samples = [];
    }
    const v = await brandsModule.saveVoice(
      services().db,
      ctx.actor,
      str(fd, 'brandId'),
      {
        formality: str(fd, 'formality') as never,
        technicalLevel: str(fd, 'technicalLevel') as never,
        length: str(fd, 'length') as never,
        emojis: str(fd, 'emojis') as never,
        addressForm: str(fd, 'addressForm') as never,
        exclamations: str(fd, 'exclamations') as never,
        phrases: str(fd, 'phrases'),
        forbiddenWords: str(fd, 'forbiddenWords'),
        openings: str(fd, 'openings'),
        closings: str(fd, 'closings'),
        hashtags: str(fd, 'hashtags'),
        ctaPreference: str(fd, 'ctaPreference'),
      },
      { samples, source: 'writing_exercise' },
    );
    target = withMessage(
      '/radar',
      'ok',
      `Tu voz quedó guardada (versión ${v.version}) con ${samples.length} texto(s) como ejemplo. Los próximos borradores la usarán.`,
    );
  } catch (e) {
    target = withMessage(PATH, 'error', userMessage(e));
  }
  redirect(target);
}
