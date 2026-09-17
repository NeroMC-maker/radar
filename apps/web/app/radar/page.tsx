import Link from 'next/link';
import { redirect } from 'next/navigation';
import { can, radarModule } from '@radar/core';
import { SubmitButton } from '@/components/client';
import { AppShell, DIRECTION_LABEL, DemoBadge, Empty, Flash } from '@/components/ui';
import { activeBrand, requireContext, services } from '@/lib/server';
import { selectBrandAction } from '@/app/actions';
import { dismissAction, feedbackAction } from './actions';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function RadarPage({ searchParams }: Props) {
  const sp = await searchParams;
  const ctx = await requireContext('/radar');
  const { brands, brand } = await activeBrand(ctx.actor, typeof sp.brand === 'string' ? sp.brand : null);
  if (!brand) {
    if (can(ctx.actor.roles, 'brand.configure')) redirect('/onboarding');
    return (
      <AppShell ctx={ctx}>
        <Empty title="Todavía no hay marcas">Pide al propietario de la organización que configure una.</Empty>
      </AppShell>
    );
  }
  const radar = await radarModule.listRadar(services().db, ctx.actor, brand.id);
  const total = radar.publishToday.length + radar.watch.length + radar.fading.length;

  return (
    <AppShell ctx={ctx}>
      <div className="row between">
        <h1>Radar · {brand.name}</h1>
        {brands.length > 1 && (
          <form action={selectBrandAction} className="row">
            <select name="brandId" defaultValue={brand.id} aria-label="Marca">
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button className="btn" type="submit">
              Ver
            </button>
          </form>
        )}
      </div>
      <Flash searchParams={sp} />
      <div className="notice">
        Fase 1: el radar usa <strong>acontecimientos de demostración</strong> (marcados DEMO). Las fuentes reales llegan en la fase 2.
      </div>

      {total === 0 ? (
        <Empty title="Sin recomendaciones todavía">
          <p className="small">
            Carga los datos de demostración con <span className="mono">pnpm seed</span> o revisa tus intereses y exclusiones en{' '}
            <Link href="/brand">Marca</Link>.
          </p>
        </Empty>
      ) : (
        <>
          <Section title="Para publicar hoy" items={radar.publishToday} brandId={brand.id} empty="Nada urgente ahora mismo." />
          <Section title="Observar" items={radar.watch} brandId={brand.id} empty="Nada en observación." />
          <Section title="Perdiendo fuerza" items={radar.fading} brandId={brand.id} empty="Nada perdiendo fuerza." />
        </>
      )}
    </AppShell>
  );
}

function Section({ title, items, brandId, empty }: { title: string; items: radarModule.RadarItem[]; brandId: string; empty: string }) {
  return (
    <section>
      <h2>
        {title} <span className="muted small">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <div className="grid grid-2">
          {items.map((i) => (
            <article key={i.recommendationId} className="card">
              <div className="row between small">
                <span className="muted">{DIRECTION_LABEL[i.direction]}</span>
                {i.isDemo && <DemoBadge />}
              </div>
              <h3 style={{ marginTop: 6 }}>
                <Link href={`/events/${i.eventId}?brand=${brandId}`}>{i.title.replace(/^\[DEMO\]\s*/, '')}</Link>
              </h3>
              <p className="small">{i.whyItMatters}</p>
              <div className="row small muted">
                <span title="Prioridad editorial 0–100">Prioridad {Math.round(i.priority)}</span>·
                <span title="Fuerza de la tendencia 0–100">Fuerza {i.strength === null ? '—' : Math.round(i.strength)}</span>·
                <span title="Índice de afinidad 0–100 (no es una probabilidad)">Afinidad {Math.round(i.affinity)}</span>·
                <span title="Confianza del cálculo según cobertura de datos">
                  Confianza {i.confidence === null ? '—' : `${Math.round(i.confidence * 100)}%`}
                </span>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <Link className="btn primary" href={`/events/${i.eventId}?brand=${brandId}`}>
                  {i.status === 'used' ? 'Ver ficha' : 'Investigar y redactar'}
                </Link>
                <form action={feedbackAction}>
                  <input type="hidden" name="recommendationId" value={i.recommendationId} />
                  <SubmitButton className="btn" name="useful" value="1">
                    👍 Útil
                  </SubmitButton>
                </form>
                <form action={dismissAction}>
                  <input type="hidden" name="recommendationId" value={i.recommendationId} />
                  <SubmitButton className="btn">Descartar</SubmitButton>
                </form>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
