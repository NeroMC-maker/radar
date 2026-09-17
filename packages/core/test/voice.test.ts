import { describe, expect, it } from 'vitest';
import { inferVoice } from '../src/domain/voice-inference';
import { SimulatedGenerator } from '../src/integrations/generator/simulated';
import { DEFAULT_VOICE, voiceSchema } from '../src/modules/brands';

describe('deducción de voz a partir de textos', () => {
  it('reconoce un estilo cercano: tuteo, emojis, cierre y CTA por mensaje', () => {
    const p = inferVoice([
      '¡Hola, comunidad! 🎉 Llegó nuestro nuevo plan para pymes. Escríbenos por DM y te contamos todo 😉 #MarketingDigital\n¡Nos vemos!',
      '¡Hola, comunidad! Súper noticia: el algoritmo ahora premia los guardados 🔥 ¿Tú ya lo probaste? Escríbenos y te ayudamos. #MarketingDigital\n¡Nos vemos!',
      'Hola! Claro que sí 🙌 Te paso los precios por mensaje, escríbenos al WhatsApp y lo vemos juntos.',
    ]);
    expect(p.traits.addressForm).toBe('tu');
    expect(p.traits.formality).toBe('informal');
    // 4 emojis en 3 textos = 1,3 por texto → pocos
    expect(p.traits.emojis).toBe('few');
    expect(p.traits.length).toBe('short');
    expect(p.traits.closings).toContain('¡Nos vemos!');
    expect(p.traits.openings).toContain('¡Hola, comunidad!');
    expect(p.traits.openings).toContain('Hola!');
    // Las expresiones no mezclan hashtags ni repiten aperturas o cierres.
    expect(p.traits.phrases.join(' ')).not.toMatch(/marketingdigital|nos vemos|hola comunidad/);
    expect(p.traits.ctaPreference).toBe('Invitar a escribir por mensaje');
    expect(p.traits.hashtags).toEqual(['#MarketingDigital']);
    expect(p.evidence.emojis).toMatch(/emoji/);
  });

  it('reconoce un estilo formal y técnico', () => {
    const p = inferVoice([
      'Estimados clientes: le informamos que nuestra plataforma incorpora una nueva integración con su CRM para mejorar la segmentación de leads. Contáctenos para una demostración.',
      'Nos complace anunciar un dashboard de métricas de conversión y ROI por campaña. Quedamos atentos a sus consultas. Saludos cordiales.',
    ]);
    expect(p.traits.formality).toBe('formal');
    expect(p.traits.addressForm).toBe('usted');
    expect(p.traits.technicalLevel).toBe('expert');
    expect(p.traits.emojis).toBe('none');
  });

  it('las aperturas escritas una por línea conservan sus comas al guardarse', () => {
    const v = voiceSchema.parse({
      ...DEFAULT_VOICE,
      openings: '¡Hola, comunidad!\nHola!',
      forbiddenWords: 'barato, gratis',
    });
    expect(v.openings).toEqual(['¡Hola, comunidad!', 'Hola!']);
    expect(v.forbiddenWords).toEqual(['barato', 'gratis']);
  });

  it('con poco texto la confianza es baja y no inventa rasgos', () => {
    const p = inferVoice(['Nuevo producto disponible.']);
    expect(p.confidence).toBeLessThan(0.3);
    expect(p.traits.addressForm).toBeUndefined();
    expect(p.traits.phrases).toEqual([]);
  });

  it('el generador respeta el tratamiento y los hashtags de la voz', async () => {
    const out = await new SimulatedGenerator().generate({
      channel: 'x',
      mode: 'informative',
      brand: { name: 'M', positioning: '', audience: 'clientes', language: 'es', goals: '' },
      voice: {
        ...DEFAULT_VOICE,
        emojis: 'none',
        addressForm: 'usted',
        ctaPreference: 'Invitar a escribir por mensaje',
        hashtags: ['#Pymes'],
      },
      approvedExamples: [],
      recentPosts: [],
      evidence: {
        title: 't',
        whatHappened: 'Algo ocurrió hoy.',
        confirmed: [],
        uncertain: [],
        sources: [{ url: 'https://example.com/a', title: 'a', platform: 'rss', isOriginal: true }],
        insufficient: false,
      },
    });
    expect(out.text).toContain('Escríbanos si desea saber más.');
    expect(out.text).toContain('#Pymes');
  });
});
