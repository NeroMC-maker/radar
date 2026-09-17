import type { VoiceTraits } from '../db/schema';

/**
 * Deduce rasgos de voz a partir de textos escritos por la persona (reglas, sin IA).
 * El resultado es una PROPUESTA: la persona la revisa y confirma antes de guardarla.
 */

export type VoiceEvidence = Partial<Record<keyof VoiceTraits, string>>;

export type VoiceProposal = {
  traits: VoiceTraits;
  evidence: VoiceEvidence;
  /** 0–1: cuánta información había para deducir */
  confidence: number;
  stats: { texts: number; words: number; avgChars: number };
};

const EMOJI = /\p{Extended_Pictographic}/gu;
const HASHTAG = /#[\p{L}\p{N}_]{2,40}/gu;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

const countMatches = (text: string, re: RegExp) => (text.match(re) ?? []).length;
const words = (s: string) => norm(s).match(/[\p{L}\p{N}]+/gu) ?? [];

// Tratamiento
const TU = /\b(tu|tus|te|ti|contigo|puedes|quieres|tienes|sabias|escribenos|cuentanos|aprovecha|descubre|visitanos|reserva|mira)\b/g;
// Sin "su/le/puede": son muy comunes en tercera persona y darían falsos positivos.
const USTED = /\b(usted|ustedes|contactenos|escribanos|visitenos|comuniquese|disculpe|desea|lo invitamos|la invitamos|le invitamos)\b/g;

const INFORMAL = /\b(jaja\w*|jeje\w*|xd|bro|chevere|bacan|pata|causa|genial|super|wow|ojo|brutal|full|che|guay|mola|ya pues|chamba|tmr|pe)\b/g;
const FORMAL = /\b(estimad[oa]s?|cordialmente|atentamente|le informamos|nos complace|agradecemos|quedamos atentos|a su disposicion|saludos cordiales)\b/g;

const TECHNICAL = [
  'api', 'seo', 'sem', 'kpi', 'roi', 'ctr', 'cpc', 'cpm', 'crm', 'b2b', 'b2c', 'saas', 'engagement', 'algoritmo',
  'conversion', 'conversiones', 'automatizacion', 'metricas', 'dashboard', 'integracion', 'funnel', 'embudo',
  'lead', 'leads', 'segmentacion', 'analytics', 'retencion', 'benchmark', 'workflow', 'machine', 'learning',
  'modelo', 'modelos', 'datos', 'insights', 'omnicanal', 'escalable', 'onboarding',
];

const GREETING = /^(¡?\s*(hola|hey|buen[oa]s? (dias|tardes|noches)|atencion|ojo|amigos|comunidad|holi)\b)/;
const SIGNOFF = /\b(saludos|abrazo|nos vemos|te esperamos|los esperamos|con carino|gracias|hasta pronto|un beso|exitos)\b/;

const CTAS: { re: RegExp; label: string }[] = [
  { re: /\b(escribenos|escribanos|mensaje|dm|md|whatsapp|inbox)\b/, label: 'Invitar a escribir por mensaje' },
  { re: /\b(reserva|reservar|agenda|agendar|cita)\b/, label: 'Invitar a reservar o agendar' },
  { re: /\b(compra|comprar|pide|pedido|tienda|oferta|descuento|promo)\b/, label: 'Invitar a comprar' },
  { re: /\b(link en (la )?bio|enlace|visita|visitanos|web)\b/, label: 'Llevar al enlace o a la web' },
  { re: /\b(comenta|cuentanos|opinas|que piensas|dejanos)\b/, label: 'Invitar a comentar' },
  { re: /\b(comparte|etiqueta|guarda)\b/, label: 'Invitar a compartir o guardar' },
  { re: /\b(siguenos|suscribete|activa las notificaciones)\b/, label: 'Invitar a seguir la cuenta' },
];

const STOP = new Set(
  'de la el en y a los las que un una por con para del al lo se es su sus mas o como pero ya muy hay ser esta este esto nos te tu mi le les sin sobre entre cuando donde'.split(
    ' ',
  ),
);

/** Primera frase corta (hasta el primer signo) o, si es larga, sus primeras 3 palabras. */
function opening(text: string) {
  const first = text.trim().split(/\n/)[0] ?? '';
  // Primero una frase completa (¡Hola, comunidad!); si no, hasta la primera coma.
  const clause = /^(.{1,40}?[!.?])(\s|$)/u.exec(first)?.[1] ?? /^(.{1,40}?[,:])(\s|$)/u.exec(first)?.[1];
  if (clause && clause.split(/\s+/).length <= 4) return clause.replace(/[,:]$/, '');
  return first.split(/\s+/).slice(0, 3).join(' ').replace(/[,.:;]+$/, '');
}

function lastLine(text: string) {
  const lines = text
    .trim()
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

function repeatedPhrases(texts: string[], exclude: string[]): string[] {
  const seen = new Map<string, Set<number>>();
  const excluded = exclude.map((e) => words(e).join(' ')).filter(Boolean);
  texts.forEach((t, i) => {
    // Las n-gramas no cruzan frases, líneas ni hashtags.
    const segments = t.replace(HASHTAG, '|').split(/[|.!?¡¿,;:\n]+/);
    for (const segment of segments) {
      const w = words(segment);
      for (const n of [2, 3]) {
        for (let k = 0; k + n <= w.length; k++) {
          const gram = w.slice(k, k + n);
          if (gram.every((x) => STOP.has(x)) || gram.some((x) => x.length < 2)) continue;
          if (STOP.has(gram[0]!) || STOP.has(gram[gram.length - 1]!)) continue;
          const key = gram.join(' ');
          if (excluded.some((e) => e.includes(key))) continue;
          const set = seen.get(key) ?? new Set<number>();
          set.add(i);
          seen.set(key, set);
        }
      }
    }
  });
  const repeated = [...seen.entries()].filter(([, s]) => s.size >= 2).map(([k, s]) => ({ k, n: s.size }));
  // Preferir las más largas y frecuentes; quitar las contenidas en otra elegida.
  repeated.sort((a, b) => b.n - a.n || b.k.length - a.k.length);
  const out: string[] = [];
  for (const r of repeated) {
    if (out.some((o) => o.includes(r.k))) continue;
    out.push(r.k);
    if (out.length === 5) break;
  }
  return out;
}

export function inferVoice(rawTexts: string[]): VoiceProposal {
  const texts = rawTexts.map((t) => t.trim()).filter((t) => t.length > 0);
  const joined = texts.join('\n\n');
  const n = Math.max(1, texts.length);
  const nj = norm(joined);
  const allWords = words(joined);
  const evidence: VoiceEvidence = {};

  // Tratamiento y formalidad
  const tu = countMatches(nj, TU);
  const usted = countMatches(nj, USTED);
  const informal = countMatches(nj, INFORMAL);
  const formal = countMatches(nj, FORMAL);
  const exclamations = countMatches(joined, /!/g);
  const emojiCount = countMatches(joined, EMOJI);

  const addressForm: VoiceTraits['addressForm'] =
    tu === 0 && usted === 0 ? undefined : tu > usted * 1.5 ? 'tu' : usted > tu * 1.5 ? 'usted' : 'mixed';
  if (addressForm) {
    evidence.addressForm =
      addressForm === 'tu'
        ? `Tuteas al lector (${tu} expresiones con "tú")`
        : addressForm === 'usted'
          ? `Tratas de usted (${usted} expresiones)`
          : `Mezclas "tú" (${tu}) y "usted" (${usted})`;
  }

  const informalScore = informal * 2 + (addressForm === 'tu' ? 2 : 0) + exclamations / n + emojiCount / n;
  const formalScore = formal * 3 + (addressForm === 'usted' ? 3 : 0);
  const formality: VoiceTraits['formality'] =
    formalScore > informalScore + 1 ? 'formal' : informalScore >= 4 ? 'informal' : 'neutral';
  evidence.formality = [
    informal ? `${informal} expresión(es) coloquial(es)` : null,
    formal ? `${formal} fórmula(s) formal(es)` : null,
    exclamations ? `${exclamations} signo(s) de exclamación` : null,
    addressForm ? evidence.addressForm?.toLowerCase() : null,
  ]
    .filter(Boolean)
    .join(' · ') || 'Sin marcas claras de formalidad: tono neutral';

  // Emojis
  const perText = emojiCount / n;
  const emojis: VoiceTraits['emojis'] = perText === 0 ? 'none' : perText <= 1.5 ? 'few' : 'many';
  evidence.emojis = emojiCount
    ? `${emojiCount} emoji(s) en ${texts.length} texto(s) (${perText.toFixed(1)} por texto)`
    : 'No usas emojis';

  // Longitud
  const avgChars = Math.round(joined.replace(/\n\n/g, '').length / n);
  const length: VoiceTraits['length'] = avgChars < 160 ? 'short' : avgChars < 400 ? 'medium' : 'long';
  evidence.length = `Tus textos tienen ${avgChars} caracteres de media`;

  // Nivel técnico
  const techHits = [...new Set(allWords.filter((w) => TECHNICAL.includes(w)))];
  const avgWordLen = allWords.length ? allWords.reduce((a, w) => a + w.length, 0) / allWords.length : 0;
  const technicalLevel: VoiceTraits['technicalLevel'] =
    techHits.length >= 3 || (techHits.length >= 1 && avgWordLen > 6.3) ? 'expert' : techHits.length >= 1 ? 'intermediate' : 'basic';
  evidence.technicalLevel = techHits.length
    ? `Términos técnicos: ${techHits.slice(0, 6).join(', ')}`
    : 'Lenguaje cotidiano, sin jerga técnica';

  // Aperturas y cierres
  const openingsCount = new Map<string, number>();
  for (const t of texts) {
    const first = opening(t);
    openingsCount.set(first, (openingsCount.get(first) ?? 0) + 1);
  }
  const openings = [...openingsCount.entries()]
    .filter(([o, c]) => c >= 2 || GREETING.test(norm(o)))
    .map(([o]) => o)
    .slice(0, 3);
  if (openings.length) evidence.openings = 'Aperturas que repites o saludos con los que empiezas';

  const closingsCount = new Map<string, number>();
  for (const t of texts) {
    const last = lastLine(t);
    if (texts.length > 0 && last.length > 0 && last.length <= 60 && !/^https?:\/\//.test(last) && !/^#/.test(last)) {
      closingsCount.set(last, (closingsCount.get(last) ?? 0) + 1);
    }
  }
  const closings = [...closingsCount.entries()]
    .filter(([c, k]) => k >= 2 || SIGNOFF.test(norm(c)))
    .map(([c]) => c)
    .slice(0, 3);
  if (closings.length) evidence.closings = 'Cierres o despedidas que usas';

  // Expresiones habituales
  const phrases = repeatedPhrases(texts, [...openings, ...closings]);
  if (phrases.length) evidence.phrases = 'Expresiones que aparecen en más de un texto';

  // Llamada a la acción
  const ctaCounts = CTAS.map((c) => ({ ...c, n: texts.filter((t) => c.re.test(norm(t))).length })).filter((c) => c.n > 0);
  ctaCounts.sort((a, b) => b.n - a.n);
  const ctaPreference = ctaCounts[0]?.label ?? 'Sin llamada a la acción habitual';
  evidence.ctaPreference = ctaCounts.length
    ? `Detectado en ${ctaCounts[0]!.n} texto(s)`
    : 'No se detectó una llamada a la acción';

  // Hashtags
  const tags = new Map<string, number>();
  for (const h of joined.match(HASHTAG) ?? []) tags.set(h, (tags.get(h) ?? 0) + 1);
  const hashtags = [...tags.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h).slice(0, 5);
  if (hashtags.length) evidence.hashtags = `${[...tags.values()].reduce((a, b) => a + b, 0)} hashtag(s) en total`;

  const excl: VoiceTraits['exclamations'] = exclamations / n >= 2 ? 'many' : exclamations > 0 ? 'some' : 'none';

  const totalWords = allWords.length;
  const confidence = Math.min(1, (texts.length / 3) * 0.5 + Math.min(1, totalWords / 150) * 0.5);

  return {
    traits: {
      formality,
      technicalLevel,
      length,
      emojis,
      phrases,
      forbiddenWords: [],
      openings,
      closings,
      ctaPreference,
      addressForm,
      hashtags,
      exclamations: excl,
    },
    evidence,
    confidence: Math.round(confidence * 100) / 100,
    stats: { texts: texts.length, words: totalWords, avgChars },
  };
}
