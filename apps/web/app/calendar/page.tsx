import Link from 'next/link';
import { draftsModule } from '@radar/core';
import { AppShell, Empty, StatusBadge, fmt } from '@/components/ui';
import { requireContext, services } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function Calendar() {
  const ctx = await requireContext('/calendar');
  const items = await draftsModule.listScheduled(services().db, ctx.actor);
  const byDay = new Map<string, typeof items>();
  for (const i of items) {
    const tz = i.timezone ?? 'America/Lima';
    const day = new Intl.DateTimeFormat('es-PE', { timeZone: tz, dateStyle: 'full' }).format(i.runAt);
    byDay.set(day, [...(byDay.get(day) ?? []), i]);
  }
  return (
    <AppShell ctx={ctx} narrow>
      <h1>Calendario</h1>
      {items.length === 0 ? (
        <Empty title="No hay publicaciones programadas">
          <p className="small">Programa una propuesta desde la pantalla de aprobación.</p>
        </Empty>
      ) : (
        [...byDay.entries()].map(([day, list]) => (
          <section key={day}>
            <h2 style={{ textTransform: 'capitalize' }}>{day}</h2>
            {list.map((i) => (
              <Link key={i.publicationId} href={`/m/drafts/${i.draftId}`} className="card" style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
                <div className="row between">
                  <strong>
                    {fmt(i.runAt, i.timezone ?? 'America/Lima')} · {i.brandName}
                  </strong>
                  <StatusBadge status={i.status} kind="publication" />
                </div>
                <p className="small" style={{ margin: '6px 0 0' }}>
                  {i.text.slice(0, 140)}
                </p>
                {i.timezone && <div className="small muted">Zona horaria: {i.timezone}</div>}
              </Link>
            ))}
          </section>
        ))
      )}
    </AppShell>
  );
}
