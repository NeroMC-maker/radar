import Link from 'next/link';
import type { ReactNode } from 'react';
import { DRAFT_STATUS_LABELS, ROLE_LABELS, type DraftStatus, type Role } from '@radar/core';
import type { PageContext } from '@/lib/server';
import { logoutAction, switchOrgAction } from '@/app/actions';

const NAV = [
  { href: '/radar', label: 'Radar' },
  { href: '/inbox', label: 'Pendientes' },
  { href: '/calendar', label: 'Calendario' },
  { href: '/history', label: 'Historial' },
  { href: '/brand', label: 'Marca' },
  { href: '/settings/notifications', label: 'Teléfono' },
  { href: '/settings/members', label: 'Miembros' },
  { href: '/ops', label: 'Estado' },
];

export function AppShell({ ctx, children, narrow }: { ctx: PageContext; children: ReactNode; narrow?: boolean }) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/radar" className="brandmark">
            ◎ Radar
          </Link>
          <nav className="navlinks" aria-label="Principal">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="navmeta">
            {ctx.orgs.length > 1 ? (
              <form action={switchOrgAction} className="row">
                <select name="orgId" defaultValue={ctx.actor.orgId} aria-label="Organización">
                  {ctx.orgs.map((o) => (
                    <option key={o.orgId} value={o.orgId}>
                      {o.orgName}
                    </option>
                  ))}
                </select>
                <button className="btn" type="submit">
                  Cambiar
                </button>
              </form>
            ) : (
              <span className="hide-sm">{ctx.orgName}</span>
            )}
            <form action={logoutAction}>
              <button className="btn link small" type="submit">
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className={`shell${narrow ? ' narrow' : ''}`}>{children}</main>
      <nav className="bottomnav" aria-label="Móvil">
        <Link href="/radar">Radar</Link>
        <Link href="/inbox">Pendientes</Link>
        <Link href="/calendar">Calendario</Link>
        <Link href="/history">Historial</Link>
        <Link href="/settings/notifications">Teléfono</Link>
      </nav>
    </>
  );
}

export function Flash({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const error = typeof searchParams.error === 'string' ? searchParams.error : null;
  const ok = typeof searchParams.ok === 'string' ? searchParams.ok : null;
  return (
    <>
      {error && (
        <div className="flash error" role="alert">
          {error}
        </div>
      )}
      {ok && (
        <div className="flash ok" role="status">
          {ok}
        </div>
      )}
    </>
  );
}

const STATUS_TONE: Partial<Record<DraftStatus | string, string>> = {
  published: 'ok',
  approved: 'info',
  queued: 'info',
  scheduled: 'info',
  publishing: 'info',
  in_review: 'warn',
  needs_review: 'warn',
  unconfirmed: 'danger',
  failed: 'danger',
  rejected: 'danger',
  cancelled: '',
};

const PUBLICATION_LABELS: Record<string, string> = {
  queued: 'En cola',
  scheduled: 'Programado',
  publishing: 'Publicando',
  published: 'Publicado',
  failed: 'Fallido',
  unconfirmed: 'Resultado pendiente de confirmar',
  cancelled: 'Cancelado',
};

export function StatusBadge({ status, kind = 'draft' }: { status: string; kind?: 'draft' | 'publication' }) {
  const label = kind === 'draft' ? DRAFT_STATUS_LABELS[status as DraftStatus] : PUBLICATION_LABELS[status];
  return <span className={`badge ${STATUS_TONE[status] ?? ''}`}>{label ?? status}</span>;
}

export function DemoBadge() {
  return (
    <span className="badge demo" title="Datos de demostración, no son noticias reales">
      DEMO
    </span>
  );
}

export function SimBadge({ what = 'Simulado' }: { what?: string }) {
  return (
    <span className="badge demo" title="Integración simulada: no sale a internet">
      {what}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card empty">
      <p>
        <strong>{title}</strong>
      </p>
      {children}
    </div>
  );
}

export function Denied({ message }: { message: string }) {
  return (
    <div className="card empty" role="alert">
      <p>
        <strong>Acceso denegado</strong>
      </p>
      <p>{message}</p>
      <Link className="btn" href="/radar">
        Volver al radar
      </Link>
    </div>
  );
}

export function Meter({ value, label }: { value: number | null; label: string }) {
  return (
    <div>
      <div className="row between small">
        <span className="muted">{label}</span>
        <strong>{value === null ? 'sin datos' : Math.round(value)}</strong>
      </div>
      <div className="meter" aria-hidden>
        <span style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
      </div>
    </div>
  );
}

export function RoleList({ roles }: { roles: string[] }) {
  return <>{roles.map((r) => ROLE_LABELS[r as Role] ?? r).join(' · ')}</>;
}

export const DIRECTION_LABEL: Record<string, string> = {
  rising: '↗ Ganando fuerza',
  stable: '→ Estable',
  fading: '↘ Perdiendo fuerza',
  unknown: '? Cobertura incompleta',
};

export function fmt(d: Date | string | null | undefined, timeZone = 'America/Lima') {
  if (!d) return '—';
  return new Intl.DateTimeFormat('es-PE', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));
}
