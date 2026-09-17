import Link from 'next/link';
import { AppError, CONTENT_MODES, CONTENT_MODE_LABELS, can, radarModule } from '@radar/core';
import { SubmitButton } from '@/components/client';
import { AppShell, DIRECTION_LABEL, DemoBadge, Denied, Flash, Meter, StatusBadge, fmt } from '@/components/ui';
import { activeBrand, requireContext, services } from '@/lib/server';
import { generateAction } from '@/app/drafts/actions';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const FACTOR_LABELS: Record<string, string> = {
  velocity: 'Velocidad de crecimiento',
  diversity: 'Diversidad de fuentes',
  novelty: 'Novedad',
  engagement: 'Engagement normalizado',
  authority: 'Autoridad temática',
  referents: 'Referentes del nicho',
};

export default async function EventPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireContext(`/events/${id}`);
  const { brand } = await activeBrand(ctx.actor, typeof sp.brand === 'string' ? sp.brand : null);
  if (!brand) return <AppShell ctx={ctx}><Denied message="Configura una marca primero." /></AppShell>;

  let d;
  try {
    d = await radarModule.getEventDetail(services().db, ctx.actor, brand.id, id);
  } catch (e) {
    if (e instanceof AppError) return <AppShell ctx={ctx}><Denied message={e.message} /></AppShell>;
    throw e;
  }
  const { event, evidence, trend, recommendation } = d;
  const factors = (trend?.factors ?? {}) as Record<string, { value: number | null; detail: string }>;

  return (
    <AppShell ctx={ctx}>
      <Link href="/radar" className="small">
        ← Radar
      </Link>
      <div className="row" style={{ marginTop: 8 }}>
        {event.isDemo && <DemoBadge />}
        <span className="badge">{event.kind}</span>
        {trend && <span className="badge info">{DIRECTION_LABEL[trend.direction]}</span>}
      </div>
      <h1 style={{ marginTop: 8 }}>{event.title.replace(/^\[DEMO\]\s*/, '')}</h1>
      <Flash searchParams={sp} />

      <div className="grid split">
        <div>
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Ficha de investigación</h2>
            {!evidence ? (
              <p className="muted">Todavía no hay evidencia suficiente para una ficha.</p>
            ) : (
              <>
                {evidence.insufficient && (
                  <div className="notice">Evidencia insuficiente: no presentes este hecho como confirmado.</div>
                )}
                <h3>Qué ocurrió</h3>
                <p>{evidence.whatHappened}</p>
                <h3>Hechos confirmados</h3>
                {evidence.confirmed.length === 0 ? (
                  <p className="muted small">Ninguno confirmado todavía.</p>
                ) : (
                  <ul>
                    {evidence.confirmed.map((c) => (
                      <li key={c.text}>
                        {c.text}{' '}
                        {c.sourceUrls.map((u, i) => (
                          <a key={u} href={u} target="_blank" rel="noreferrer noopener" className="small">
                            [{i + 1}]
                          </a>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
                {evidence.uncertain.length > 0 && (
                  <>
                    <h3>Aspectos inciertos</h3>
                    <ul>
                      {evidence.uncertain.map((c) => (
                        <li key={c.text}>{c.text}</li>
                      ))}
                    </ul>
                  </>
                )}
                {evidence.participants.length > 0 && (
                  <p className="small">
                    <strong>Participantes:</strong> {evidence.participants.join(', ')}
                  </p>
                )}
                <h3>Fuentes</h3>
                <ul className="small">
                  {evidence.sources.map((s) => (
                    <li key={s.url}>
                      <a href={s.url} target="_blank" rel="noreferrer noopener">
                        {s.title}
                      </a>{' '}
                      <span className="muted">
                        · {s.platform}
                        {s.isOriginal ? ' · fuente original' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="small muted">
                  Versión {evidence.version} · actualizada {fmt(evidence.createdAt, brand.timezone)}
                </p>
              </>
            )}
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0 }}>Señales ({d.signals.length})</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Plataforma</th>
                    <th>Señal</th>
                    <th>Métricas</th>
                  </tr>
                </thead>
                <tbody>
                  {d.signals.map((s) => (
                    <tr key={s.id}>
                      <td>{s.platform}</td>
                      <td>
                        {s.url ? (
                          <a href={s.url} target="_blank" rel="noreferrer noopener">
                            {s.title}
                          </a>
                        ) : (
                          s.title
                        )}
                        <div className="small muted">
                          {s.author} · {fmt(s.publishedAt, brand.timezone)}
                        </div>
                      </td>
                      <td className="small">
                        {s.latestMetrics
                          ? Object.entries(s.latestMetrics)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(', ')
                          : <span className="muted">no disponible</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div>
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Relevancia para {brand.name}</h2>
            {recommendation ? (
              <>
                <p>{recommendation.whyItMatters}</p>
                <div className="stack">
                  <Meter label="Prioridad editorial" value={recommendation.priority} />
                  <Meter label="Afinidad (índice, no probabilidad)" value={recommendation.affinity} />
                  <Meter label="Fuerza de la tendencia" value={trend?.strength ?? null} />
                </div>
                <p className="small muted" style={{ marginTop: 10 }}>
                  Confianza {trend ? `${Math.round(trend.confidence * 100)}%` : '—'} · pesos {trend?.weightsVersion ?? '—'}
                </p>
                <details>
                  <summary>Por qué este cálculo</summary>
                  <ul className="small">
                    {Object.entries(FACTOR_LABELS).map(([k, label]) => (
                      <li key={k}>
                        <strong>{label}:</strong>{' '}
                        {factors[k]?.value === null || factors[k] === undefined ? 'sin datos (no cuenta como cero)' : Math.round((factors[k]!.value as number) * 100)}
                        <div className="muted">{factors[k]?.detail}</div>
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            ) : (
              <p className="muted">
                Este acontecimiento no está recomendado para la marca (puede coincidir con una exclusión).
              </p>
            )}
          </section>

          {can(ctx.actor.roles, 'draft.create') && evidence && recommendation && (
            <section className="card">
              <h2 style={{ marginTop: 0 }}>Preparar contenido para X</h2>
              <form action={generateAction}>
                <input type="hidden" name="brandId" value={brand.id} />
                <input type="hidden" name="eventId" value={event.id} />
                <input type="hidden" name="back" value={`/events/${event.id}?brand=${brand.id}`} />
                <div className="field">
                  <label htmlFor="mode">Modo</label>
                  <select id="mode" name="mode" defaultValue="informative">
                    {CONTENT_MODES.map((m) => (
                      <option key={m} value={m}>
                        {CONTENT_MODE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="angle">
                    Ángulo editorial <span className="hint">(opcional)</span>
                  </label>
                  <input id="angle" name="angle" placeholder="qué significa para agencias pequeñas" />
                </div>
                <SubmitButton className="btn primary block" pending="Generando…">
                  Generar borrador
                </SubmitButton>
                <p className="small muted" style={{ marginTop: 8 }}>
                  Generación simulada con plantillas (sin IA ni coste). Al terminar se avisa al teléfono de los aprobadores.
                </p>
              </form>
            </section>
          )}

          {d.drafts.length > 0 && (
            <section className="card">
              <h2 style={{ marginTop: 0 }}>Propuestas sobre este tema</h2>
              <ul className="small">
                {d.drafts.map((x) => (
                  <li key={x.id}>
                    <Link href={`/drafts/${x.id}`}>{fmt(x.createdAt, brand.timezone)}</Link> <StatusBadge status={x.status} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}
