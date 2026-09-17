import { ROLES, ROLE_LABELS, can, identity } from '@radar/core';
import { SubmitButton } from '@/components/client';
import { AppShell, Flash, RoleList } from '@/components/ui';
import { requireContext, services } from '@/lib/server';
import { updateRolesAction } from './actions';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Members({ searchParams }: Props) {
  const sp = await searchParams;
  const ctx = await requireContext('/settings/members');
  const members = await identity.listMembers(services().db, ctx.actor);
  const manage = can(ctx.actor.roles, 'members.manage');
  return (
    <AppShell ctx={ctx} narrow>
      <h1>Miembros y permisos</h1>
      <Flash searchParams={sp} />
      <p className="small muted">
        Propietario: organización, miembros y conexiones. Editor: investigar y redactar. Aprobador: aprobar, programar y publicar. Los
        permisos se comprueban en el servidor en cada operación.
      </p>
      {members.map((m) => (
        <div key={m.userId} className="card">
          <div className="row between">
            <div>
              <strong>{m.name}</strong>
              <div className="small muted">{m.email}</div>
            </div>
            <span className="small">
              <RoleList roles={m.roles} />
            </span>
          </div>
          {manage && (
            <form action={updateRolesAction} className="row" style={{ marginTop: 10 }}>
              <input type="hidden" name="userId" value={m.userId} />
              {ROLES.map((r) => (
                <label key={r} className="row" style={{ fontWeight: 400, margin: 0 }}>
                  <input type="checkbox" name="roles" value={r} defaultChecked={m.roles.includes(r)} /> {ROLE_LABELS[r]}
                </label>
              ))}
              <SubmitButton className="btn">Guardar</SubmitButton>
            </form>
          )}
        </div>
      ))}
      <p className="small muted">Las invitaciones de nuevos miembros se añaden en la fase 5 (piloto).</p>
    </AppShell>
  );
}
