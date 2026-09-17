import type { ContentGenerator, GenerationInput, GenerationOutput } from './types';

const X_LIMIT = 280;

/**
 * Generador SIMULADO: arma el texto con plantillas a partir de la evidencia y la voz.
 * No usa IA ni tiene coste. Sirve para validar el recorrido completo.
 */
export class SimulatedGenerator implements ContentGenerator {
  readonly id = 'simulated';
  readonly live = false;

  async generate(input: GenerationInput): Promise<GenerationOutput> {
    const { evidence, voice, brand, mode } = input;
    const notes: string[] = ['Texto generado con plantilla (IA simulada). Revísalo antes de aprobar.'];

    if (evidence.insufficient) notes.push('La evidencia es insuficiente: no presentes el hecho como confirmado.');
    if (evidence.uncertain.length) {
      notes.push(`Aspectos sin confirmar: ${evidence.uncertain.map((u) => u.text).join('; ')}`);
    }

    let angle = input.angle?.trim() || defaultAngle(mode);
    if (mode === 'opinion' && !brand.positioning.trim()) {
      notes.push(
        'La marca no tiene un posicionamiento definido: no se le atribuye una opinión. Elige uno de estos ángulos: ' +
          '"qué significa para tu audiencia", "preguntas abiertas", "datos clave".',
      );
      angle = 'qué significa para tu audiencia';
    }

    const opening = voice.openings[0] ?? (mode === 'breaking' ? 'Última hora:' : '');
    const closing = voice.closings[0] ?? '';
    const emoji = voice.emojis === 'none' ? '' : mode === 'breaking' ? '⚡ ' : '📌 ';
    const fact = firstSentence(evidence.whatHappened);
    const hedge = evidence.insufficient ? 'Según reportes iniciales, ' : '';
    const why =
      mode === 'simple'
        ? `En pocas palabras: ${lowerFirst(evidence.confirmed[0]?.text ?? fact)}`
        : mode === 'educational' || mode === 'technical'
          ? `Clave: ${lowerFirst(evidence.confirmed[0]?.text ?? fact)}`
          : brand.audience
            ? `Por qué importa a ${brand.audience}: ${angle}.`
            : '';
    const source = evidence.sources.find((s) => s.isOriginal) ?? evidence.sources[0];

    const parts = [
      [(emoji + opening).trim(), hedge + fact].filter(Boolean).join(' '),
      why,
      closing,
      source?.url ?? '',
    ].filter(Boolean);

    let text = parts.join('\n\n');
    if (text.length > X_LIMIT) {
      // X cuenta cada URL como 23 caracteres; se recorta el cuerpo, nunca la fuente.
      const url = source?.url ?? '';
      const budget = X_LIMIT - (url ? 25 : 0) - 1;
      const body = parts.slice(0, -1).join('\n\n');
      text = `${body.slice(0, budget).trimEnd()}…${url ? `\n\n${url}` : ''}`;
      notes.push('El texto se recortó para respetar el límite de X.');
    }

    for (const w of voice.forbiddenWords) {
      if (w && text.toLowerCase().includes(w.toLowerCase())) notes.push(`Contiene una palabra prohibida: "${w}"`);
    }

    return {
      text,
      angle,
      references: evidence.sources.map((s) => ({ url: s.url, title: s.title })),
      reviewNotes: notes,
      generator: 'simulated',
      costUsd: 0,
    };
  }
}

function defaultAngle(mode: GenerationInput['mode']): string {
  switch (mode) {
    case 'educational':
      return 'explicar el concepto detrás del anuncio';
    case 'technical':
      return 'detalles técnicos relevantes';
    case 'simple':
      return 'explicarlo sin jerga';
    case 'breaking':
      return 'contar el hecho rápido y con fuente';
    case 'opinion':
      return 'postura basada en el posicionamiento aprobado';
    default:
      return 'qué pasó y dónde leer más';
  }
}

function firstSentence(s: string) {
  const m = /^[^.!?]+[.!?]/.exec(s.trim());
  return (m ? m[0] : s).trim();
}

function lowerFirst(s: string) {
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}
