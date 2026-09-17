import { SubmitButton } from '@/components/client';
import { BrandFields } from '@/components/brand-form';
import { AppShell, Denied, Flash } from '@/components/ui';
import { can } from '@radar/core';
import { requireContext } from '@/lib/server';
import { createBrandAction } from '@/app/brand/actions';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Onboarding({ searchParams }: Props) {
  const sp = await searchParams;
  const ctx = await requireContext('/onboarding');
  if (!can(ctx.actor.roles, 'brand.configure')) {
    return (
      <AppShell ctx={ctx}>
        <Denied message="Solo el propietario puede crear marcas." />
      </AppShell>
    );
  }
  return (
    <AppShell ctx={ctx}>
      <h1>Configura tu marca</h1>
      <p className="muted">Lo haces una vez. Después Radar busca oportunidades y te avisa al teléfono.</p>
      <Flash searchParams={sp} />
      <form action={createBrandAction} className="card">
        <BrandFields />
        <SubmitButton className="btn primary" pending="Guardando…">
          Crear marca
        </SubmitButton>
      </form>
    </AppShell>
  );
}
