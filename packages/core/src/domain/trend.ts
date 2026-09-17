/**
 * Motor de tendencias: funciones puras y reproducibles.
 * Tres resultados separados: fuerza (del acontecimiento), afinidad (con una marca) y prioridad editorial.
 * El modelo de lenguaje nunca produce estas cifras.
 */

export const TREND_WEIGHTS_V1 = {
  version: 'v1',
  velocity: 0.3,
  diversity: 0.2,
  novelty: 0.15,
  engagement: 0.15,
  authority: 0.1,
  referents: 0.1,
} as const;

export type TrendWeights = {
  version: string;
  velocity: number;
  diversity: number;
  novelty: number;
  engagement: number;
  authority: number;
  referents: number;
};

type FactorKey = Exclude<keyof TrendWeights, 'version'>;
const FACTOR_KEYS: FactorKey[] = ['velocity', 'diversity', 'novelty', 'engagement', 'authority', 'referents'];

export type SignalObservation = {
  platform: string;
  author: string | null;
  firstSeenAt: Date;
  /** Autoridad temática de la fuente 0–1, si se conoce */
  authority?: number | null;
  /** Mediciones históricas; métrica ausente = clave ausente */
  measurements: { observedAt: Date; metrics: Record<string, number> }[];
};

export type TrendInput = {
  now: Date;
  eventFirstSeenAt: Date;
  signals: SignalObservation[];
  /** handles "plataforma:usuario" de referentes del nicho (capa pública) */
  referentHandles: string[];
  /** Referencia de engagement típico por plataforma (mediana) para normalizar */
  platformBaselines: Record<string, number>;
  /** Salud de la recolección de las fuentes implicadas en la ventana: 0–1 */
  collectionHealth: number;
  windowHours?: number;
};

export type FactorResult = { value: number | null; detail: string };

export type TrendResult = {
  weightsVersion: string;
  /** 0–100 */
  strength: number;
  /** 0–1 */
  confidence: number;
  direction: 'rising' | 'stable' | 'fading' | 'unknown';
  factors: Record<FactorKey, FactorResult> & { coverage: number; collectionHealth: number };
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const HOUR = 3_600_000;

/** Engagement total de una medición: suma de las métricas presentes. */
function engagementOf(metrics: Record<string, number>): number {
  return Object.values(metrics).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

/** Último valor de engagement de una señal antes de `t` (null si no hay medición). */
function engagementAt(s: SignalObservation, t: Date): number | null {
  let best: { at: number; value: number } | null = null;
  for (const m of s.measurements) {
    const at = m.observedAt.getTime();
    if (at <= t.getTime() && Object.keys(m.metrics).length > 0 && (!best || at > best.at)) {
      best = { at, value: engagementOf(m.metrics) };
    }
  }
  return best ? best.value : null;
}

export function computeTrend(input: TrendInput, weights: TrendWeights = TREND_WEIGHTS_V1): TrendResult {
  const W = (input.windowHours ?? 6) * HOUR;
  const now = input.now.getTime();
  const tPrev = new Date(now - W);
  const tPrev2 = new Date(now - 2 * W);

  // Velocidad: ventanas equivalentes, crecimiento suavizado (evita % engañosos con bases pequeñas).
  const newRecent = input.signals.filter((s) => s.firstSeenAt.getTime() > now - W).length;
  const newPrevious = input.signals.filter(
    (s) => s.firstSeenAt.getTime() > now - 2 * W && s.firstSeenAt.getTime() <= now - W,
  ).length;
  let engRecent = 0;
  let engPrevious = 0;
  let measured = 0;
  for (const s of input.signals) {
    const eNow = engagementAt(s, input.now);
    if (eNow === null) continue;
    const e1 = engagementAt(s, tPrev) ?? 0;
    const e2 = engagementAt(s, tPrev2) ?? 0;
    const base = input.platformBaselines[s.platform] ?? 100;
    engRecent += (eNow - e1) / base;
    engPrevious += (e1 - e2) / base;
    measured++;
  }
  const PRIOR = 2; // suavizado: un salto de 1 a 3 no es "+200 %"
  const activityRecent = newRecent + engRecent;
  const activityPrevious = newPrevious + engPrevious;
  const growth = (activityRecent - activityPrevious) / (activityPrevious + PRIOR);
  const velocity: FactorResult = {
    value: clamp01(0.5 + Math.atan(growth) / Math.PI),
    detail: `${newRecent} señales nuevas vs ${newPrevious} en la ventana anterior de ${W / HOUR} h; crecimiento suavizado ${growth.toFixed(2)}`,
  };

  // Diversidad de fuentes y participantes.
  const platforms = new Set(input.signals.map((s) => s.platform));
  const authors = new Set(input.signals.map((s) => s.author).filter(Boolean));
  const diversity: FactorResult =
    input.signals.length === 0
      ? { value: null, detail: 'Sin señales' }
      : {
          value: clamp01(0.5 * (1 - Math.exp(-authors.size / 5)) + 0.5 * Math.min(1, platforms.size / 3)),
          detail: `${authors.size} participantes en ${platforms.size} plataforma(s)`,
        };

  // Novedad.
  const ageHours = (now - input.eventFirstSeenAt.getTime()) / HOUR;
  const novelty: FactorResult = {
    value: clamp01(Math.exp(-Math.max(0, ageHours) / 24)),
    detail: `Detectado hace ${ageHours.toFixed(1)} h`,
  };

  // Engagement normalizado dentro de cada plataforma.
  const engagement: FactorResult =
    measured === 0
      ? { value: null, detail: 'Las fuentes no aportan métricas de engagement' }
      : (() => {
          let total = 0;
          for (const s of input.signals) {
            const e = engagementAt(s, input.now);
            if (e === null) continue;
            total += e / (input.platformBaselines[s.platform] ?? 100);
          }
          return {
            value: clamp01(Math.log1p(total) / Math.log1p(20)),
            detail: `Engagement equivalente a ${total.toFixed(1)}× la mediana de su plataforma (${measured} señal(es) medidas)`,
          };
        })();

  // Autoridad temática.
  const withAuthority = input.signals.filter((s) => typeof s.authority === 'number');
  const authority: FactorResult =
    withAuthority.length === 0
      ? { value: null, detail: 'Autoridad de las fuentes desconocida' }
      : {
          value: clamp01(Math.max(...withAuthority.map((s) => s.authority as number))),
          detail: `Autoridad máxima entre ${withAuthority.length} fuente(s)`,
        };

  // Participación de referentes del nicho (identidades explícitas).
  const refSet = new Set(input.referentHandles.map((h) => h.toLowerCase()));
  const refCount = input.signals.filter(
    (s) => s.author && refSet.has(`${s.platform}:${s.author}`.toLowerCase()),
  ).length;
  const referents: FactorResult =
    refSet.size === 0
      ? { value: null, detail: 'No hay referentes configurados' }
      : { value: clamp01(refCount / 2), detail: `${refCount} referente(s) participan` };

  const factors = { velocity, diversity, novelty, engagement, authority, referents };

  // Métricas ausentes no cuentan como cero: se redistribuye el peso y baja la confianza.
  let weighted = 0;
  let usedWeight = 0;
  let totalWeight = 0;
  for (const k of FACTOR_KEYS) {
    totalWeight += weights[k];
    const v = factors[k].value;
    if (v === null) continue;
    weighted += v * weights[k];
    usedWeight += weights[k];
  }
  const coverage = totalWeight === 0 ? 0 : usedWeight / totalWeight;
  const strength = usedWeight === 0 ? 0 : (weighted / usedWeight) * 100;
  const health = clamp01(input.collectionHealth);
  const volume = Math.min(1, input.signals.length / 3);
  const confidence = clamp01(coverage * health * (0.5 + 0.5 * volume));

  // Una caída con recolección degradada no se interpreta como pérdida de interés.
  let direction: TrendResult['direction'];
  if (health < 0.7) direction = 'unknown';
  else if (growth > 0.25) direction = 'rising';
  else if (growth < -0.25) direction = 'fading';
  else direction = 'stable';

  return {
    weightsVersion: weights.version,
    strength: round1(strength),
    confidence: round2(confidence),
    direction,
    factors: { ...factors, coverage: round2(coverage), collectionHealth: round2(health) },
  };
}

/* ─────────────── Afinidad con la marca ─────────────── */

export type BrandProfileForAffinity = {
  interests: string[];
  exclusions: string[];
  audience: string;
  offering: string;
  language: string;
  market: string;
  referentHandles: string[];
  /** utilidad previa por tema: {tema: [útiles, total]} */
  feedbackByTopic?: Record<string, [number, number]>;
};

export type EventForAffinity = {
  title: string;
  summary: string;
  topics: string[];
  language: string | null;
  participantHandles: string[];
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

const tokens = (s: string) => new Set(normalize(s).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2));

function mentions(haystack: string, term: string): boolean {
  const t = normalize(term).trim();
  if (!t) return false;
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u');
  return pattern.test(haystack);
}

/** Devuelve la exclusión que coincide, o null. Se aplica antes de ordenar. */
export function matchedExclusion(brand: Pick<BrandProfileForAffinity, 'exclusions'>, ev: EventForAffinity): string | null {
  const text = normalize([ev.title, ev.summary, ...ev.topics].join(' \n '));
  return brand.exclusions.find((x) => mentions(text, x)) ?? null;
}

export type AffinityResult =
  | { excluded: true; exclusion: string }
  | { excluded: false; affinity: number; factors: Record<string, { value: number; detail: string }> };

/** Índice de afinidad 0–100. No es una probabilidad. */
export function computeAffinity(brand: BrandProfileForAffinity, ev: EventForAffinity): AffinityResult {
  const exclusion = matchedExclusion(brand, ev);
  if (exclusion) return { excluded: true, exclusion };

  const text = normalize([ev.title, ev.summary, ...ev.topics].join(' \n '));
  const hitInterests = brand.interests.filter((i) => mentions(text, i));
  const interests = {
    value: brand.interests.length ? Math.min(1, hitInterests.length / Math.min(2, brand.interests.length)) : 0,
    detail: hitInterests.length ? `Coincide con: ${hitInterests.join(', ')}` : 'Sin coincidencias con tus intereses',
  };

  const evTokens = tokens(text);
  const overlap = (s: string) => {
    const t = [...tokens(s)];
    return t.length ? t.filter((x) => evTokens.has(x)).length / t.length : 0;
  };
  const audienceOffering = {
    value: Math.min(1, 2 * Math.max(overlap(brand.audience), overlap(brand.offering))),
    detail: 'Relación con tu audiencia y tu oferta',
  };

  const refs = new Set(brand.referentHandles.map((h) => h.toLowerCase()));
  const refHits = ev.participantHandles.filter((h) => refs.has(h.toLowerCase()));
  const referents = {
    value: Math.min(1, refHits.length / 2),
    detail: refHits.length ? `Participan tus referentes: ${refHits.join(', ')}` : 'Tus referentes no participan',
  };

  const languageMatch = {
    value: !ev.language || ev.language === brand.language ? 1 : 0.5,
    detail: !ev.language ? 'Idioma no determinado' : ev.language === brand.language ? 'Mismo idioma' : `Idioma ${ev.language}`,
  };

  let fbUseful = 0;
  let fbTotal = 0;
  for (const t of ev.topics) {
    const fb = brand.feedbackByTopic?.[t];
    if (fb) {
      fbUseful += fb[0];
      fbTotal += fb[1];
    }
  }
  const feedbackF = {
    // Prior neutro 0.5 con suavizado para pocos votos
    value: (fbUseful + 1) / (fbTotal + 2),
    detail: fbTotal ? `${fbUseful}/${fbTotal} valoraciones útiles en temas similares` : 'Sin feedback previo',
  };

  const affinity =
    100 *
    (0.45 * interests.value +
      0.15 * audienceOffering.value +
      0.15 * referents.value +
      0.1 * languageMatch.value +
      0.15 * feedbackF.value);

  return {
    excluded: false,
    affinity: round1(affinity),
    factors: { interests, audienceOffering, referents, language: languageMatch, feedback: feedbackF },
  };
}

/* ─────────────── Prioridad editorial ─────────────── */

export function computePriority(input: {
  strength: number;
  affinity: number;
  confidence: number;
  ageHours: number;
  alreadyCovered: boolean;
}): { priority: number; factors: Record<string, number> } {
  const recency = 100 * Math.exp(-Math.max(0, input.ageHours) / 36);
  const base = 0.4 * input.strength + 0.4 * input.affinity + 0.1 * recency + 0.1 * input.confidence * 100;
  const penalty = input.alreadyCovered ? 40 : 0;
  return {
    priority: round1(Math.max(0, base - penalty)),
    factors: {
      strength: input.strength,
      affinity: input.affinity,
      recency: round1(recency),
      confidence: input.confidence,
      coveragePenalty: penalty,
    },
  };
}

function round1(x: number) {
  return Math.round(x * 10) / 10;
}
function round2(x: number) {
  return Math.round(x * 100) / 100;
}
