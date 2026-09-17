import Link from 'next/link';
import { AppError, EDITABLE, can, draftsModule, is } from '@radar/core';
import { PostEditor, SubmitButton } from '@/components/client';
import { AppShell, DemoBadge, Denied, Flash, SimBadge, StatusBadge, fmt } from '@/components/ui';
import { requireContextForOrg, safeNext, services } from '@/lib/server';
import { editAction, rejectAction } from '../actions';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Editor de escritorio: contenido, destino, ángulo y versiones. */
export default async function DraftEditor({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const path = `/drafts/${id}`;
  const svc = services();
  const ctx = await requireContextForOrg(path, await draftsModule.draftOrgId(svc.db, id));
  const back = safeNext(typeof sp.back === 'string' ? sp.back : null, path);

  let d;
  try {
    d = await draftsModule.getDraftForReview(svc.db, ctx.actor, id);
  } catch (e) {
    if (e instanceof AppError) {
      return (
        <AppShell ctx={ctx}>
          <Denied message="Esta propuesta no existe o no pertenece a tu organización." />
        </AppShell>
      );
    }
    throw e;
  }
  const { draft, brand, current, versions, event } = d;
  const editable = can(ctx.actor.roles, 'draft.edit') && is(draft.status, EDITABLE) && current;

  return (
    <AppShell ctx={ctx}>
      <div className="row between">
        <Link href={back !== path ? back : '/inbox'} className="small">
          ← Volver
        </Link>
        <Link className="btn primary" href={`/m/drafts/${draft.id}`}>
          Revisar y aprobar
        </Link>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <h1 style={{ margin: 0 }}>Propuesta · {brand.name}</h1>
        <StatusBadge status={draft.status} />
        {event?.isDemo && <DemoBadge />}
      </div>
      <Flash searchParams={sp} />
      {is(draft.status, ['approved', 'scheduled', 'queued']) && (
        <div className="notice">Está aprobada. Si guardas cambios, la aprobación se anula y habrá que revisarla de nuevo.</div>
      )}

      <div className="grid split">
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Contenido</h2>
          {editable ? (
            <form action={editAction}>
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="versionId" value={current.id} />
              <input type="hidden" name="back" value={back} />
              <PostEditor name="text" defaultValue={current.text} limit={280} />
              <div className="field">
                <label htmlFor="socialAccountId">Destino</label>
                <select id="socialAccountId" name="socialAccountId" defaultValue={draft.socialAccountId ?? ''}>
                  {d.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      X · @{a.handle} {a.mode === 'simulated' ? '(simulada)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <SubmitButton className="btn primary" pending="Guardando…">
                  Guardar nueva versión
                </SubmitButton>
              </div>
            </form>
          ) : (
            <>
              <pre className="post">{current?.text}</pre>
              <p className="small muted">
                {is(draft.status, EDITABLE) ? 'Tu rol no permite editar.' : 'Esta propuesta ya no se puede editar.'}
              </p>
            </>
          )}
          {current && (
            <p className="small muted" style={{ marginTop: 10 }}>
              Modo {current.mode} · ángulo: {current.angle || '—'} · voz v{d.voiceVersion ?? '—'} · evidencia v
              {d.evidence?.version ?? '—'} {current.generator === 'simulated' && <SimBadge what="IA simulada" />}
            </p>
          )}
          {current?.reviewNotes.length ? (
            <div className="notice">
              {current.reviewNotes.map((n) => (
                <div key={n}>• {n}</div>
              ))}
            </div>
          ) : null}
          {current?.references.length ? (
            <>
              <h3>Referencias</h3>
              <ul className="small">
                {current.references.map((r) => (
                  <li key={r.url}>
                    <a href={r.url} target="_blank" rel="noreferrer noopener">
                      {r.title}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {can(ctx.actor.roles, 'draft.approve') && is(draft.status, ['draft', 'in_review', 'needs_review']) && (
            <form action={rejectAction} className="row" style={{ marginTop: 12 }}>
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="back" value={path} />
              <input name="reason" placeholder="Motivo del rechazo (opcional)" style={{ flex: 1, minWidth: 180 }} />
              <SubmitButton className="btn danger">Rechazar</SubmitButton>
            </form>
          )}
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Versiones</h2>
          <ol reversed className="small">
            {versions.map((v) => (
              <li key={v.id} style={{ marginBottom: 8 }}>
                <strong>v{v.number}</strong> · {v.generator === 'human' ? 'edición manual' : v.generator} · {fmt(v.createdAt, brand.timezone)}
                {v.id === draft.currentVersionId && <span className="badge info" style={{ marginLeft: 6 }}>actual</span>}
                <details>
                  <summary>Ver texto</summary>
                  <pre className="post small">{v.text}</pre>
                </details>
              </li>
            ))}
          </ol>
          <h2>Envíos</h2>
          {d.publications.length === 0 ? (
            <p className="muted small">Sin envíos todavía.</p>
          ) : (
            <ul className="small">
              {d.publications.map((p) => (
                <li key={p.id}>
                  <StatusBadge status={p.status} kind="publication" /> {fmt(p.runAt, brand.timezone)} · intentos {p.attempts}
                  {p.lastError && <div className="muted">{p.lastError}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
