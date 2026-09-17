import { notificationsModule } from '@radar/core';
import { AutoRefresh, SubmitButton } from '@/components/client';
import { AppShell, Flash, SimBadge, fmt } from '@/components/ui';
import { requireContext, services } from '@/lib/server';
import { disconnectAction, savePrefsAction, simulateLinkAction, startLinkAction } from './actions';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const KIND_LABELS: Record<string, string> = {
  draft_ready: 'Nueva propuesta',
  publication_published: 'Publicado',
  publication_failed: 'Fallo al publicar',
  publication_unconfirmed: 'Envío incierto',
};

export default async function NotificationsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const ctx = await requireContext('/settings/notifications');
  const svc = services();
  const recipient = await notificationsModule.getOwnRecipient(svc, ctx.actor);
  const linked = !!recipient?.verifiedAt && !!recipient.address;
  const pendingCode =
    !linked && recipient?.linkCode && recipient.linkCodeExpiresAt && recipient.linkCodeExpiresAt > new Date() ? recipient.linkCode : null;
  const linkUrl = pendingCode ? await svc.notifier.linkUrl(pendingCode) : null;
  const log = linked ? await notificationsModule.notificationLog(svc, ctx.actor) : [];
  const localUrl = /localhost|127\.0\.0\.1/.test(svc.config.PUBLIC_BASE_URL);

  return (
    <AppShell ctx={ctx} narrow>
      <AutoRefresh active={!!pendingCode} everyMs={3000} />
      <h1>Avisos al teléfono</h1>
      <Flash searchParams={sp} />

      {!svc.notifier.live && (
        <div className="notice">
          <strong>Telegram no está configurado</strong>: los avisos se simulan en la consola del worker. Para recibirlos de verdad, crea un bot con
          @BotFather, pon el token en <span className="mono">TELEGRAM_BOT_TOKEN</span> del archivo <span className="mono">.env</span> y reinicia.
        </div>
      )}
      {localUrl && (
        <div className="notice">
          <span className="mono">PUBLIC_BASE_URL</span> apunta a localhost: el botón del aviso no abrirá nada en el iPhone. Usa la IP de tu PC en la
          misma Wi-Fi (p. ej. <span className="mono">http://192.168.1.20:3000</span>) o una URL https.
        </div>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Telegram {!svc.notifier.live && <SimBadge />}</h2>
        {linked ? (
          <>
            <p>
              ✅ Vinculado {fmt(recipient!.verifiedAt, recipient!.timezone)}
              {recipient!.address?.startsWith('sim-') && ' (simulado)'}.
            </p>
            <form action={disconnectAction}>
              <SubmitButton className="btn danger">Desconectar</SubmitButton>
            </form>
          </>
        ) : pendingCode ? (
          <>
            <p>
              1. Abre este enlace <strong>en tu iPhone</strong> (con Telegram instalado) y pulsa <strong>Iniciar</strong>:
            </p>
            {linkUrl ? (
              <a className="btn primary block" href={linkUrl}>
                Abrir Telegram
              </a>
            ) : (
              <p className="muted small">El bot no está disponible (modo simulado).</p>
            )}
            <p className="small muted" style={{ marginTop: 8 }}>
              Si abriste esta página en la computadora, escribe al bot desde el iPhone: <span className="mono">/start {pendingCode}</span>
            </p>
            <p className="small muted">2. Esta página se actualiza sola cuando se complete. El código caduca en 30 minutos.</p>
          </>
        ) : (
          <>
            <p>Recibe cada propuesta en el iPhone con un botón para revisarla y publicarla.</p>
            <form action={startLinkAction}>
              <SubmitButton className="btn primary block">Conectar Telegram</SubmitButton>
            </form>
          </>
        )}
        {!svc.notifier.live && !linked && (
          <form action={simulateLinkAction} style={{ marginTop: 10 }}>
            <SubmitButton className="btn block">Vincular en modo simulado (para probar)</SubmitButton>
          </form>
        )}
      </section>

      {recipient && linked && (
        <form action={savePrefsAction} className="card">
          <h2 style={{ marginTop: 0 }}>Preferencias</h2>
          <div className="field row">
            <input id="enabled" name="enabled" type="checkbox" defaultChecked={recipient.enabled} />
            <label htmlFor="enabled" style={{ margin: 0 }}>
              Recibir avisos
            </label>
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="quietStart">Silencio desde</label>
              <input id="quietStart" name="quietStart" type="time" defaultValue={recipient.quietStart ?? ''} />
            </div>
            <div className="field">
              <label htmlFor="quietEnd">Silencio hasta</label>
              <input id="quietEnd" name="quietEnd" type="time" defaultValue={recipient.quietEnd ?? ''} />
            </div>
            <div className="field">
              <label htmlFor="timezone">Zona horaria</label>
              <input id="timezone" name="timezone" defaultValue={recipient.timezone} required />
            </div>
            <div className="field">
              <label htmlFor="dailyLimit">Máximo de avisos por día</label>
              <input id="dailyLimit" name="dailyLimit" type="number" min={1} max={100} defaultValue={recipient.dailyLimit} />
            </div>
          </div>
          <p className="small muted">Durante el silencio los avisos esperan; las propuestas siguen en Pendientes.</p>
          <SubmitButton className="btn primary">Guardar</SubmitButton>
        </form>
      )}

      {log.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Últimos avisos</h2>
          <p className="small muted">"Aceptado" significa que Telegram recibió el mensaje, no que lo hayas leído.</p>
          <ul className="small">
            {log.map((n) => (
              <li key={n.id}>
                {KIND_LABELS[n.kind] ?? n.kind} ·{' '}
                {n.status === 'accepted' ? 'aceptado' : n.status === 'suppressed' ? 'omitido (límite diario)' : `fallido: ${n.error}`} ·{' '}
                {fmt(n.createdAt, recipient!.timezone)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
