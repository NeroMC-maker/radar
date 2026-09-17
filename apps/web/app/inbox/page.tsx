import Link from 'next/link';
import { draftsModule } from '@radar/core';
import { AppShell, Empty, Flash, StatusBadge, fmt } from '@/components/ui';
import { requireContext, services } from '@/lib/server';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Bandeja de pendientes: existe aunque falle la notificación. */
export default async function Inbox({ searchParams }: Props) {
  const sp = await searchParams;
  const ctx = await requireContext('/inbox');
  const items = await draftsModule.listPending(services().db, ctx.actor);
  return (
    <AppShell ctx={ctx} narrow>
      <h1>Pendientes</h1>
      <Flash searchParams={sp} />
      {items.length === 0 ? (
        <Empty title="No hay nada pendiente">
          <p className="small">
            Cuando haya una propuesta te llegará un aviso al teléfono. Puedes generar una desde el <Link href="/radar">radar</Link>.
          </p>
        </Empty>
      ) : (
        items.map((i) => (
          <Link key={i.id} href={`/m/drafts/${i.id}`} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
            <div className="row between">
              <strong>{i.brandName}</strong>
              <StatusBadge status={i.status} />
            </div>
            <p className="small" style={{ margin: '6px 0' }}>
              {(i.text ?? '').slice(0, 140)}
              {(i.text ?? '').length > 140 ? '…' : ''}
            </p>
            <div className="small muted">
              {i.eventTitle?.replace(/^\[DEMO\]\s*/, '')} · {fmt(i.updatedAt)}
            </div>
          </Link>
        ))
      )}
    </AppShell>
  );
}
