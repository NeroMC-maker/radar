import { AppError, auditModule, runner } from '@radar/core';
import { AppShell, Denied, fmt } from '@/components/ui';
import { requireContext, services } from '@/lib/server';

export const dynamic = 'force-dynamic';

const STATE_BADGE: Record<string, string> = { real: 'ok', simulada: 'demo', pendiente: 'warn' };

export default async function Ops() {
  const ctx = await requireContext('/ops');
  const svc = services();
  let s;
  try {
    s = await runner.operationsStatus(svc, ctx.actor);
  } catch (e) {
    if (e instanceof AppError) return <AppShell ctx={ctx}><Denied message="Solo el propietario ve el estado operativo." /></AppShell>;
    throw e;
  }
  const audit = await auditModule.recentAudit(svc.db, ctx.actor.orgId, 25);

  return (
    <AppShell ctx={ctx}>
      <h1>Estado operativo y consumo</h1>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Integraciones</h2>
        <table>
          <tbody>
            {s.integrations.map((i) => (
              <tr key={i.name}>
                <td>{i.name}</td>
                <td>
                  <span className={`badge ${STATE_BADGE[i.state]}`}>{i.state.toUpperCase()}</span>
                </td>
                <td className="small muted">{i.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid grid-3">
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Cola de trabajos</h2>
          <p>Pendientes: {s.jobs.pending ?? 0}</p>
          <p>En curso: {s.jobs.running ?? 0}</p>
          <p>Fallidos: {s.jobs.failed ?? 0}</p>
        </section>
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Publicaciones</h2>
          <p>En cola / programadas: {(s.publications.queued ?? 0) + (s.publications.scheduled ?? 0)}</p>
          <p>Fallidas: {s.publications.failed ?? 0}</p>
          <p>Inciertas: {s.publications.unconfirmed ?? 0}</p>
          <p className="small muted">
            Tiempo medio hasta publicar (24 h): {s.avgSecondsToPublish === null ? '—' : `${Math.round(s.avgSecondsToPublish)} s`}
          </p>
        </section>
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Consumo (24 h)</h2>
          <p>
            Coste estimado: <strong>{s.spentUsd.toFixed(2)} USD</strong> de {s.dailyBudgetUsd} USD
          </p>
          <ul className="small">
            {s.usage.map((u) => (
              <li key={u.kind}>
                {u.kind}: {u.units} · {u.costUsd.toFixed(2)} USD
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Auditoría reciente</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td className="small">{fmt(a.createdAt)}</td>
                  <td className="mono">{a.action}</td>
                  <td className="small muted">
                    {a.entity} {a.entityId?.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
