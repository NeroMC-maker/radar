import Link from 'next/link';
import { draftsModule } from '@radar/core';
import { AppShell, Empty, SimBadge, StatusBadge, fmt } from '@/components/ui';
import { requireContext, services } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function History() {
  const ctx = await requireContext('/history');
  const items = await draftsModule.listHistory(services().db, ctx.actor);
  return (
    <AppShell ctx={ctx}>
      <h1>Historial de publicaciones</h1>
      {items.length === 0 ? (
        <Empty title="Todavía no hay publicaciones" />
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Estado</th>
                <th>Contenido</th>
                <th>Destino</th>
                <th>Fecha</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.publicationId}>
                  <td>
                    <StatusBadge status={i.status} kind="publication" />
                  </td>
                  <td>
                    <Link href={`/drafts/${i.draftId}`}>{i.text.slice(0, 80)}…</Link>
                    <div className="small muted">
                      {i.brandName} · versión {i.versionNumber}
                    </div>
                  </td>
                  <td>
                    X · @{i.handle} {i.accountMode === 'simulated' && <SimBadge />}
                  </td>
                  <td className="small">{fmt(i.publishedAt ?? i.runAt)}</td>
                  <td className="small">
                    {i.externalUrl && i.accountMode !== 'simulated' ? (
                      <a href={i.externalUrl} target="_blank" rel="noreferrer noopener">
                        Ver en X
                      </a>
                    ) : i.externalUrl ? (
                      <span className="muted mono">{i.externalUrl.split('/').pop()}</span>
                    ) : null}
                    {i.lastError && <div style={{ color: 'var(--danger)' }}>{i.lastError}</div>}
                    <div className="muted">intentos: {i.attempts}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
