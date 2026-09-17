import Link from 'next/link';
import { can } from '@radar/core';
import { AppShell, Denied, Empty, Flash } from '@/components/ui';
import { activeBrand, requireContext } from '@/lib/server';
import { VoiceWizard } from './voice-wizard';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Ejercicios de escritura para deducir la voz de la marca y validarla. */
export default async function VoicePage({ searchParams }: Props) {
  const sp = await searchParams;
  const ctx = await requireContext('/brand/voice');
  const { brand } = await activeBrand(ctx.actor);
  if (!brand) {
    return (
      <AppShell ctx={ctx} narrow>
        <Empty title="Primero crea una marca">
          <Link className="btn primary" href="/onboarding">
            Crear marca
          </Link>
        </Empty>
      </AppShell>
    );
  }
  if (!can(ctx.actor.roles, 'brand.configure')) {
    return (
      <AppShell ctx={ctx} narrow>
        <Denied message="Solo el propietario puede configurar la voz de la marca." />
      </AppShell>
    );
  }

  const audience = brand.audience || 'tus seguidores';
  const topic = brand.industry || brand.interests[0] || 'tu sector';
  const exercises = [
    {
      title: 'Anuncia una novedad',
      prompt: `Cuéntale a ${audience} una novedad de ${brand.name}: un servicio, un producto, una promoción o un logro.`,
      placeholder: 'Ej.: ¡Tenemos noticias! Desde hoy…',
    },
    {
      title: 'Comenta una tendencia',
      prompt: `Opina sobre algo que esté pasando en ${topic}, como lo publicarías hoy.`,
      placeholder: 'Ej.: ¿Viste que…? Para nosotros esto significa…',
    },
    {
      title: 'Responde a un cliente',
      prompt: 'Alguien te escribe: "¿Cuánto cuesta y cómo contrato?". Respóndele como lo harías de verdad.',
      placeholder: 'Ej.: ¡Hola! Gracias por escribirnos…',
    },
  ];

  const isNew = sp.nueva === '1';

  return (
    <AppShell ctx={ctx} narrow>
      {!isNew && (
        <Link href="/brand" className="small">
          ← Marca
        </Link>
      )}
      <h1 style={{ marginTop: 8 }}>{isNew ? 'Paso 2: ¿cómo escribes?' : 'Descubre tu voz escribiendo'}</h1>
      <p className="muted">
        Escribe estos textos con tus palabras, sin pensarlo demasiado. Radar analizará tu tono, cómo tratas al lector, tus emojis, saludos,
        despedidas y llamadas a la acción, y los usará en cada borrador.
      </p>
      <Flash searchParams={sp} />
      <VoiceWizard brandId={brand.id} brandName={brand.name} exercises={exercises} />
      {isNew && (
        <p className="small" style={{ marginTop: 16 }}>
          <Link href="/radar">Saltar por ahora</Link> <span className="muted">(puedes hacerlo luego desde Marca)</span>
        </p>
      )}
    </AppShell>
  );
}
