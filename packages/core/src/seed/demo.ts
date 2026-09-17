import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { eventSignals, events, evidenceVersions, signalMeasurements, signals } from '../db/schema';

/**
 * Señales y acontecimientos de DEMOSTRACIÓN (is_demo = true, se muestran con etiqueta "DEMO").
 * No son noticias reales: los nombres son ficticios. Sirven para probar el recorrido completo.
 * Las fechas son relativas a "ahora" para que el motor de tendencias tenga algo que medir.
 */
type DemoSignal = {
  key: string;
  platform: string;
  author: string;
  title: string;
  hoursAgo: number;
  /** engagement observado hace 12 h, 6 h y ahora (null = la fuente no da métricas) */
  series: [number, number, number] | null;
  relation?: 'original' | 'syndicated' | 'independent';
};

type DemoEvent = {
  id: string;
  title: string;
  summary: string;
  kind: string;
  topics: string[];
  hoursAgo: number;
  whatHappened: string;
  confirmed: string[];
  uncertain: string[];
  participants: string[];
  insufficient?: boolean;
  signals: DemoSignal[];
};

const DEMO: DemoEvent[] = [
  {
    id: '00000000-0000-4000-8000-00000000d001',
    title: '[DEMO] NovaAI lanza agentes que automatizan reportes de redes sociales',
    summary: 'La empresa ficticia NovaAI presentó agentes de inteligencia artificial para community managers que generan reportes semanales de redes sociales.',
    kind: 'launch',
    topics: ['inteligencia artificial', 'redes sociales', 'automatización', 'marketing digital'],
    hoursAgo: 5,
    whatHappened: 'NovaAI (empresa ficticia de demostración) presentó agentes de IA que generan reportes semanales de redes sociales para community managers.',
    confirmed: ['Los agentes generan reportes semanales a partir de las métricas de cada cuenta.', 'La función está disponible en beta para cuentas empresariales.'],
    uncertain: ['El precio final para agencias todavía no se anunció.'],
    participants: ['NovaAI', 'comunidad de marketing digital'],
    signals: [
      { key: 'd1-blog', platform: 'rss', author: 'novaai-blog', title: 'Presentamos los agentes de reportes', hoursAgo: 5, series: null, relation: 'original' },
      { key: 'd1-hn', platform: 'hackernews', author: 'pmurphy', title: 'NovaAI agents for social media reporting', hoursAgo: 4, series: [0, 40, 260] },
      { key: 'd1-x1', platform: 'x', author: 'martamkt', title: 'Probé los agentes de NovaAI con 3 clientes', hoursAgo: 3, series: [0, 120, 900] },
      { key: 'd1-x2', platform: 'x', author: 'socialdata_es', title: 'Hilo: qué cambia para los CM', hoursAgo: 2, series: [0, 0, 640] },
      { key: 'd1-news', platform: 'rss', author: 'marketingnews', title: 'NovaAI entra al mercado de reportes para agencias', hoursAgo: 1.5, series: null, relation: 'syndicated' },
    ],
  },
  {
    id: '00000000-0000-4000-8000-00000000d002',
    title: '[DEMO] Plataforma de video corto cambia su algoritmo para priorizar guardados',
    summary: 'Una plataforma ficticia de video corto anunció que los guardados pesarán más que los “me gusta” en su algoritmo de recomendación.',
    kind: 'news',
    topics: ['redes sociales', 'algoritmo', 'video corto', 'marketing digital'],
    hoursAgo: 9,
    whatHappened: 'ClipZone (plataforma ficticia de demostración) anunció que los guardados tendrán más peso que los “me gusta” en su algoritmo.',
    confirmed: ['El cambio se aplica de forma gradual durante el mes.'],
    uncertain: ['No está claro si afecta a cuentas con menos de 1.000 seguidores.', 'Algunos creadores reportan caídas de alcance, sin datos verificados.'],
    participants: ['ClipZone', 'creadores de contenido'],
    signals: [
      { key: 'd2-blog', platform: 'rss', author: 'clipzone-news', title: 'Actualización del algoritmo', hoursAgo: 9, series: null, relation: 'original' },
      { key: 'd2-reddit', platform: 'reddit', author: 'creatorlab', title: 'Anyone else seeing reach drop?', hoursAgo: 7, series: [0, 200, 380] },
      { key: 'd2-x1', platform: 'x', author: 'martamkt', title: 'Guardados > likes: qué hacer', hoursAgo: 6, series: [0, 300, 520] },
    ],
  },
  {
    id: '00000000-0000-4000-8000-00000000d003',
    title: '[DEMO] Framework open source publica versión 3.0 con editor visual',
    summary: 'Un framework ficticio de código abierto lanzó su versión 3.0 con un editor visual para landing pages.',
    kind: 'release',
    topics: ['open source', 'desarrollo web', 'herramientas'],
    hoursAgo: 30,
    whatHappened: 'OpenPage (proyecto ficticio de demostración) publicó la versión 3.0 con un editor visual de landing pages.',
    confirmed: ['La versión 3.0 incluye editor visual y plantillas.'],
    uncertain: [],
    participants: ['OpenPage'],
    signals: [
      { key: 'd3-gh', platform: 'github', author: 'openpage', title: 'Release v3.0.0', hoursAgo: 30, series: [700, 760, 790], relation: 'original' },
      { key: 'd3-hn', platform: 'hackernews', author: 'devnull', title: 'OpenPage 3.0', hoursAgo: 28, series: [300, 330, 335] },
    ],
  },
  {
    id: '00000000-0000-4000-8000-00000000d004',
    title: '[DEMO] Rumor: red social profesional prepararía suscripción para empresas',
    summary: 'Circula un rumor, sin confirmación oficial, sobre una suscripción para páginas de empresa en una red profesional ficticia.',
    kind: 'news',
    topics: ['redes sociales', 'marketing b2b', 'suscripciones'],
    hoursAgo: 3,
    whatHappened: 'Se reporta, sin confirmación oficial, que WorkNet (red ficticia de demostración) prepararía una suscripción para páginas de empresa.',
    confirmed: [],
    uncertain: ['La empresa no confirmó el anuncio.', 'No se conocen precios ni fechas.'],
    participants: ['WorkNet'],
    insufficient: true,
    signals: [{ key: 'd4-x1', platform: 'x', author: 'rumoresb2b', title: 'Me cuentan que WorkNet…', hoursAgo: 3, series: [0, 10, 60] }],
  },
  {
    id: '00000000-0000-4000-8000-00000000d005',
    title: '[DEMO] Nueva ley de apuestas en línea genera debate',
    summary: 'Un país ficticio debate una ley de apuestas en línea con restricciones publicitarias.',
    kind: 'news',
    topics: ['apuestas', 'regulación', 'publicidad'],
    hoursAgo: 4,
    whatHappened: 'El parlamento de un país ficticio debate una ley que restringe la publicidad de apuestas en línea.',
    confirmed: ['El proyecto de ley fue presentado esta semana.'],
    uncertain: [],
    participants: ['parlamento ficticio'],
    signals: [
      { key: 'd5-news', platform: 'rss', author: 'diario-demo', title: 'Debate sobre apuestas', hoursAgo: 4, series: null, relation: 'original' },
      { key: 'd5-x', platform: 'x', author: 'politicademo', title: 'Opiniones divididas', hoursAgo: 2, series: [0, 50, 400] },
    ],
  },
];

const H = 3_600_000;

export async function seedDemo(db: Db, now = new Date()) {
  await db.transaction(async (tx) => {
    for (const ev of DEMO) {
      const firstSeen = new Date(now.getTime() - ev.hoursAgo * H);
      await tx
        .insert(events)
        .values({
          id: ev.id,
          title: ev.title,
          summary: ev.summary,
          kind: ev.kind,
          topics: ev.topics,
          language: 'es',
          isDemo: true,
          firstSeenAt: firstSeen,
        })
        .onConflictDoUpdate({
          target: events.id,
          set: { title: ev.title, summary: ev.summary, topics: ev.topics, firstSeenAt: firstSeen, updatedAt: now },
        });

      const sourcesList = ev.signals.map((s) => ({
        url: `https://example.com/demo/${s.key}`,
        title: s.title,
        platform: s.platform,
        isOriginal: s.relation === 'original',
      }));
      const [existing] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(evidenceVersions)
        .where(eq(evidenceVersions.eventId, ev.id));
      if (!existing?.n) {
        await tx.insert(evidenceVersions).values({
          eventId: ev.id,
          version: 1,
          whatHappened: ev.whatHappened,
          confirmed: ev.confirmed.map((text) => ({ text, sourceUrls: [sourcesList[0]!.url] })),
          uncertain: ev.uncertain.map((text) => ({ text, sourceUrls: sourcesList.slice(-1).map((s) => s.url) })),
          sources: sourcesList,
          participants: ev.participants,
          insufficient: ev.insufficient ?? false,
        });
      }

      for (const s of ev.signals) {
        const publishedAt = new Date(now.getTime() - s.hoursAgo * H);
        const [sig] = await tx
          .insert(signals)
          .values({
            platform: s.platform,
            externalId: `demo:${s.key}`,
            url: `https://example.com/demo/${s.key}`,
            author: s.author,
            title: s.title,
            language: 'es',
            publishedAt,
            discoveredAt: publishedAt,
            isDemo: true,
            usageRestrictions: { demo: true },
          })
          .onConflictDoUpdate({
            target: [signals.platform, signals.externalId],
            set: { publishedAt, discoveredAt: publishedAt },
          })
          .returning();
        await tx
          .insert(eventSignals)
          .values({ eventId: ev.id, signalId: sig!.id, relation: s.relation ?? 'independent' })
          .onConflictDoNothing();
        await tx.delete(signalMeasurements).where(inArray(signalMeasurements.signalId, [sig!.id]));
        if (s.series) {
          const points: [number, number][] = [
            [12, s.series[0]],
            [6, s.series[1]],
            [0, s.series[2]],
          ];
          for (const [hAgo, value] of points) {
            const at = new Date(now.getTime() - hAgo * H);
            if (at < publishedAt) continue;
            await tx.insert(signalMeasurements).values({
              signalId: sig!.id,
              observedAt: at,
              metrics: s.platform === 'github' ? { stars: value } : { likes: Math.round(value * 0.7), comments: Math.round(value * 0.3) },
            });
          }
        }
      }
    }
  });
  return DEMO.length;
}
