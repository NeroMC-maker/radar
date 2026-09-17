import { describe, expect, it } from 'vitest';
import { contentHash } from '../src/domain/content-hash';
import { statusAfterEdit } from '../src/domain/draft-states';
import { can } from '../src/domain/roles';
import { quietHoursEnd, utcToZonedLocal, zonedLocalToUtc } from '../src/domain/time';
import { computeAffinity, computeTrend, type TrendInput } from '../src/domain/trend';

const now = new Date('2026-09-16T12:00:00Z');
const h = (n: number) => new Date(now.getTime() - n * 3_600_000);

const baseInput = (over: Partial<TrendInput> = {}): TrendInput => ({
  now,
  eventFirstSeenAt: h(4),
  signals: [],
  referentHandles: [],
  platformBaselines: { x: 100, hackernews: 100 },
  collectionHealth: 1,
  ...over,
});

describe('motor de tendencias', () => {
  it('es reproducible: mismas entradas, mismo resultado', () => {
    const input = baseInput({
      signals: [
        { platform: 'x', author: 'a', firstSeenAt: h(2), measurements: [{ observedAt: now, metrics: { likes: 300 } }] },
      ],
    });
    expect(computeTrend(input)).toEqual(computeTrend(input));
  });

  it('no convierte métricas ausentes en cero: baja la confianza y excluye el factor', () => {
    const r = computeTrend(
      baseInput({ signals: [{ platform: 'rss', author: 'blog', firstSeenAt: h(2), measurements: [] }] }),
    );
    expect(r.factors.engagement.value).toBeNull();
    expect(r.factors.referents.value).toBeNull();
    expect(r.factors.coverage).toBeLessThan(1);
    expect(r.confidence).toBeLessThan(0.8);
  });

  it('evita crecimientos engañosos con bases pequeñas', () => {
    const small = computeTrend(
      baseInput({
        signals: [
          { platform: 'x', author: 'a', firstSeenAt: h(10), measurements: [{ observedAt: h(6), metrics: { likes: 1 } }, { observedAt: now, metrics: { likes: 3 } }] },
        ],
      }),
    );
    // De 1 a 3 no debe verse como una explosión.
    expect(small.factors.velocity.value!).toBeLessThan(0.6);
  });

  it('una caída con recolección degradada se marca como desconocida, no como pérdida de interés', () => {
    const r = computeTrend(
      baseInput({
        collectionHealth: 0.3,
        signals: [{ platform: 'x', author: 'a', firstSeenAt: h(11), measurements: [] }],
      }),
    );
    expect(r.direction).toBe('unknown');
  });

  it('las exclusiones eliminan la recomendación antes de calcular afinidad', () => {
    const r = computeAffinity(
      { interests: ['redes sociales'], exclusions: ['apuestas'], audience: '', offering: '', language: 'es', market: '', referentHandles: [] },
      { title: 'Ley de Apuestas', summary: '', topics: ['regulación'], language: 'es', participantHandles: [] },
    );
    expect(r).toEqual({ excluded: true, exclusion: 'apuestas' });
  });

  it('la afinidad sube con los intereses de la marca', () => {
    const brand = { interests: ['inteligencia artificial'], exclusions: [], audience: '', offering: '', language: 'es', market: '', referentHandles: [] };
    const hit = computeAffinity(brand, { title: 'Nueva Inteligencia Artificial', summary: '', topics: [], language: 'es', participantHandles: [] });
    const miss = computeAffinity(brand, { title: 'Receta de pan', summary: '', topics: [], language: 'es', participantHandles: [] });
    expect(hit.excluded || miss.excluded).toBe(false);
    if (!hit.excluded && !miss.excluded) expect(hit.affinity).toBeGreaterThan(miss.affinity);
  });
});

describe('zonas horarias', () => {
  it('convierte hora local de Lima a UTC', () => {
    expect(zonedLocalToUtc('2026-09-20T09:30', 'America/Lima').toISOString()).toBe('2026-09-20T14:30:00.000Z');
  });

  it('respeta el horario de verano de Madrid', () => {
    expect(zonedLocalToUtc('2026-07-01T10:00', 'Europe/Madrid').toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedLocalToUtc('2026-12-01T10:00', 'Europe/Madrid').toISOString()).toBe('2026-12-01T09:00:00.000Z');
  });

  it('ida y vuelta', () => {
    const t = new Date('2026-09-20T14:30:00Z');
    expect(utcToZonedLocal(t, 'America/Lima')).toBe('2026-09-20T09:30');
  });

  it('horario silencioso que cruza medianoche', () => {
    // 23:00 en Lima = 04:00 UTC del día siguiente
    const end = quietHoursEnd(new Date('2026-09-17T04:00:00Z'), 'America/Lima', '22:00', '07:00');
    expect(end?.toISOString()).toBe('2026-09-17T12:00:00.000Z');
    expect(quietHoursEnd(new Date('2026-09-17T17:00:00Z'), 'America/Lima', '22:00', '07:00')).toBeNull();
  });
});

describe('reglas editoriales', () => {
  it('editar algo aprobado exige nueva revisión', () => {
    expect(statusAfterEdit('queued')).toBe('needs_review');
    expect(statusAfterEdit('scheduled')).toBe('needs_review');
    expect(() => statusAfterEdit('published')).toThrow();
    expect(() => statusAfterEdit('publishing')).toThrow();
  });

  it('cambiar el destino cambia la huella de aprobación', () => {
    const a = contentHash({ text: 'hola', assets: [], socialAccountId: 'a' });
    const b = contentHash({ text: 'hola', assets: [], socialAccountId: 'b' });
    expect(a).not.toBe(b);
  });

  it('solo el rol aprobador aprueba', () => {
    expect(can(['editor'], 'draft.approve')).toBe(false);
    expect(can(['approver'], 'draft.approve')).toBe(true);
    expect(can(['owner'], 'draft.approve')).toBe(false);
  });
});
