import Link from 'next/link';
import {
  APPROVABLE,
  AppError,
  can,
  draftsModule,
  is,
  utcToZonedLocal,
} from '@radar/core';
import { AutoRefresh, Reveal, SubmitButton } from '@/components/client';
import { DemoBadge, Denied, Flash, SimBadge, StatusBadge, fmt } from '@/components/ui';
import { requireContextForOrg, services } from '@/lib/server';
import {
  approveNowAction,
  cancelScheduledAction,
  discardAction,
  resolveUnconfirmedAction,
  scheduleAction,
} from '@/app/drafts/actions';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Pantalla de aprobación móvil: la abre el botón de la notificación.
 * Abrirla no aprueba nada; las acciones exigen sesión y rol de aprobador.
 */
export default async function MobileReview({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const path = `/m/drafts/${id}`;
  const svc = services();
  const ctx = await requireContextForOrg(path, await draftsModule.draftOrgId(svc.db, id));

  let data;
  try {
    data = await draftsModule.getDraftForReview(svc.db, ctx.actor, id);
  } catch (e) {
    if (e instanceof AppError) {
      return (
        <main className="shell narrow">
          <Denied message="Esta propuesta no existe o no pertenece a tus organizaciones." />
        </main>
      );
    }
    throw e;
  }

  const { draft, brand, account, current, evidence, recommendation, publication, event } = data;
  const canApprove = can(ctx.actor.roles, 'draft.approve');
  const approvable = is(draft.status, APPROVABLE) && current;
  const inFlight = draft.status === 'queued' || draft.status === 'publishing';
  const simulated = account?.mode !== 'live';
  const originalSource = evidence?.sources.find((s) => s.isOriginal) ?? evidence?.sources[0];
  const minLocal = utcToZonedLocal(new Date(Date.now() + 5 * 60_000), brand.timezone);

  return (
    <main className="shell narrow">
      <AutoRefresh active={inFlight} />
      <div className="row between" style={{ marginBottom: 8 }}>
        <Link href="/inbox" className="small">
          ← Pendientes
        </Link>
        <StatusBadge status={draft.status} />
      </div>
      <Flash searchParams={sp} />

      <div className="card">
        <div className="row between">
          <strong>{brand.name}</strong>
          {event?.isDemo && <DemoBadge />}
        </div>
        <div className="row small muted" style={{ marginTop: 4 }}>
          <span>
            X · @{account?.handle ?? '—'}
          </span>
          {simulated && <SimBadge what="Publicación simulada" />}
        </div>
      </div>

      {draft.status === 'needs_review' && (
        <div className="notice">El contenido o la evidencia cambiaron después de aprobar. Revisa esta versión antes de publicar.</div>
      )}

      <pre className="post">{current?.text}</pre>
      <p className="small muted" style={{ marginTop: 6 }}>
        Versión {current?.number} · {current?.text.length} caracteres · voz v{data.voiceVersion ?? '—'} ·{' '}
        {current?.generator === 'simulated' ? 'generado con plantilla (IA simulada)' : current?.generator === 'human' ? 'editado a mano' : current?.generator}
      </p>
      {current?.assets.length ? (
        <div className="row">
          {current.assets.map((a) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={a.url} src={a.url} alt={a.alt} style={{ maxWidth: '100%', borderRadius: 8 }} />
          ))}
        </div>
      ) : null}

      {current?.reviewNotes.length ? (
        <div className="notice">
          {current.reviewNotes.map((n) => (
            <div key={n}>• {n}</div>
          ))}
        </div>
      ) : null}

      <div className="card small">
        {recommendation && (
          <p>
            <strong>Por qué:</strong> {recommendation.whyItMatters}
          </p>
        )}
        {event && (
          <p>
            <strong>Acontecimiento:</strong> {event.title}
          </p>
        )}
        {originalSource && (
          <p>
            <strong>Fuente:</strong>{' '}
            <a href={originalSource.url} target="_blank" rel="noreferrer noopener">
              {originalSource.title}
            </a>
          </p>
        )}
        <p className="muted" style={{ margin: 0 }}>
          Información actualizada: {fmt(evidence?.createdAt, brand.timezone)}
          {evidence?.insufficient ? ' · evidencia insuficiente' : ''}
        </p>
      </div>

      {/* Resultado */}
      {inFlight && <div className="card">⏳ Publicando… esta pantalla se actualiza sola.</div>}
      {draft.status === 'scheduled' && publication && (
        <div className="card">
          <p>
            📅 Programado para <strong>{fmt(publication.runAt, brand.timezone)}</strong> ({brand.timezone})
          </p>
          {canApprove && (
            <form action={cancelScheduledAction}>
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="back" value={path} />
              <SubmitButton className="btn block">Cancelar programación</SubmitButton>
            </form>
          )}
        </div>
      )}
      {draft.status === 'published' && publication && (
        <div className="card">
          <p>
            ✅ Publicado {fmt(publication.publishedAt, brand.timezone)}
          </p>
          {publication.externalUrl &&
            (simulated ? (
              <p className="small muted">
                Enlace simulado (no existe en X): <span className="mono">{publication.externalUrl}</span>
              </p>
            ) : (
              <a className="btn primary block" href={publication.externalUrl} target="_blank" rel="noreferrer noopener">
                Ver en X
              </a>
            ))}
        </div>
      )}
      {draft.status === 'failed' && publication?.lastError && (
        <div className="flash error">No se pudo publicar: {publication.lastError}</div>
      )}
      {draft.status === 'unconfirmed' && canApprove && (
        <div className="card">
          <p>
            <strong>No sabemos si se publicó.</strong> Revisa la cuenta @{account?.handle} en X antes de decidir. No se
            reintentará solo para evitar duplicados.
          </p>
          <p className="small muted">{publication?.lastError}</p>
          <form action={resolveUnconfirmedAction} className="stack">
            <input type="hidden" name="draftId" value={draft.id} />
            <input type="hidden" name="back" value={path} />
            <input name="externalUrl" type="url" placeholder="Enlace del post (opcional)" inputMode="url" />
            <SubmitButton className="btn block" name="outcome" value="published">
              Sí se publicó
            </SubmitButton>
            <SubmitButton className="btn block" name="outcome" value="not_published">
              No se publicó: reintentar
            </SubmitButton>
          </form>
        </div>
      )}

      {/* Acciones */}
      {approvable && canApprove && (
        <div className="actionbar stack">
          <form action={approveNowAction}>
            <input type="hidden" name="draftId" value={draft.id} />
            <input type="hidden" name="versionId" value={current.id} />
            <input type="hidden" name="back" value={path} />
            <SubmitButton className="btn primary block big" pending="Publicando…">
              {draft.status === 'failed' ? 'Reintentar publicación' : simulated ? 'Aprobar y publicar (simulado)' : 'Aprobar y publicar'}
            </SubmitButton>
          </form>
          <Reveal label="Programar">
            <form action={scheduleAction} className="card">
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="versionId" value={current.id} />
              <input type="hidden" name="back" value={path} />
              <label htmlFor="scheduleLocal">
                Fecha y hora <span className="hint">({brand.timezone})</span>
              </label>
              <input id="scheduleLocal" name="scheduleLocal" type="datetime-local" min={minLocal} required />
              <div style={{ marginTop: 10 }}>
                <SubmitButton className="btn primary block">Aprobar y programar</SubmitButton>
              </div>
            </form>
          </Reveal>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Link className="btn" style={{ flex: 1 }} href={`/drafts/${draft.id}?back=${encodeURIComponent(path)}`}>
              Editar
            </Link>
            <form action={discardAction} style={{ flex: 1 }}>
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="back" value={path} />
              <SubmitButton className="btn danger block">Descartar</SubmitButton>
            </form>
          </div>
        </div>
      )}
      {approvable && !canApprove && (
        <div className="notice">Tu rol no permite aprobar. Un aprobador de la organización debe autorizar esta propuesta.</div>
      )}
    </main>
  );
}
