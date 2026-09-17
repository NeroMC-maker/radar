import Link from 'next/link';
import { brandsModule, can } from '@radar/core';
import { SubmitButton } from '@/components/client';
import { BrandFields } from '@/components/brand-form';
import { AppShell, Empty, Flash, SimBadge, fmt } from '@/components/ui';
import { activeBrand, requireContext, services } from '@/lib/server';
import { addExampleAction, saveVoiceAction, updateBrandAction } from './actions';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function BrandPage({ searchParams }: Props) {
  const sp = await searchParams;
  const ctx = await requireContext('/brand');
  const { brand } = await activeBrand(ctx.actor);
  if (!brand) {
    return (
      <AppShell ctx={ctx}>
        <Empty title="No hay marcas">
          <Link className="btn primary" href="/onboarding">
            Crear marca
          </Link>
        </Empty>
      </AppShell>
    );
  }
  const db = services().db;
  const [voice, examples, accounts] = await Promise.all([
    brandsModule.currentVoice(db, ctx.actor, brand.id),
    brandsModule.listApprovedExamples(db, ctx.actor, brand.id),
    brandsModule.brandAccounts(db, ctx.actor, brand.id),
  ]);
  const editable = can(ctx.actor.roles, 'brand.configure');
  const x = accounts.find((a) => a.platform === 'x');
  const t = voice.traits;

  return (
    <AppShell ctx={ctx}>
      <div className="row between">
        <h1>Marca · {brand.name}</h1>
        <Link className="btn" href="/onboarding">
          + Otra marca
        </Link>
      </div>
      <Flash searchParams={sp} />
      {!editable && <div className="notice">Solo el propietario puede modificar la configuración.</div>}

      <form action={updateBrandAction} className="card">
        <h2 style={{ marginTop: 0 }}>Perfil y temas</h2>
        <input type="hidden" name="brandId" value={brand.id} />
        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
          <BrandFields brand={brand} xHandle={x?.handle} />
          <SubmitButton className="btn primary">Guardar perfil</SubmitButton>
        </fieldset>
      </form>

      <div className="grid grid-2">
        <form action={saveVoiceAction} className="card">
          <h2 style={{ marginTop: 0 }}>
            Voz de marca <span className="badge">v{voice.version}</span>
          </h2>
          <p className="small muted">Cada cambio crea una versión nueva; cada borrador registra la versión que usó.</p>
          {editable && (
            <Link className="btn block" href="/brand/voice" style={{ marginBottom: 12 }}>
              ✍️ Descubrir mi voz escribiendo
            </Link>
          )}
          <input type="hidden" name="brandId" value={brand.id} />
          <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="grid grid-2">
              <Select name="formality" label="Formalidad" value={t.formality} options={{ informal: 'Informal', neutral: 'Neutral', formal: 'Formal' }} />
              <Select name="technicalLevel" label="Nivel técnico" value={t.technicalLevel} options={{ basic: 'Básico', intermediate: 'Intermedio', expert: 'Experto' }} />
              <Select name="length" label="Longitud" value={t.length} options={{ short: 'Corta', medium: 'Media', long: 'Larga' }} />
              <Select name="emojis" label="Emojis" value={t.emojis} options={{ none: 'Ninguno', few: 'Pocos', many: 'Muchos' }} />
              <Select name="addressForm" label="Trato al lector" value={t.addressForm ?? ''} options={{ '': 'Sin preferencia', tu: 'Tú', usted: 'Usted', mixed: 'Mixto' }} />
              <Select name="exclamations" label="Exclamaciones" value={t.exclamations ?? 'none'} options={{ none: 'Ninguna', some: 'Algunas', many: 'Muchas' }} />
            </div>
            <ListField name="phrases" label="Expresiones habituales" value={t.phrases} multiline />
            <ListField name="forbiddenWords" label="Palabras prohibidas" value={t.forbiddenWords} />
            <ListField name="openings" label="Aperturas" value={t.openings} multiline />
            <ListField name="closings" label="Cierres" value={t.closings} multiline />
            <ListField name="hashtags" label="Hashtags habituales" value={t.hashtags ?? []} />
            <div className="field">
              <label htmlFor="ctaPreference">Llamadas a la acción</label>
              <input id="ctaPreference" name="ctaPreference" defaultValue={t.ctaPreference} />
            </div>
            <SubmitButton className="btn primary">Guardar voz (nueva versión)</SubmitButton>
          </fieldset>
        </form>

        <div>
          <form action={addExampleAction} className="card">
            <h2 style={{ marginTop: 0 }}>Ejemplos aprobados</h2>
            <input type="hidden" name="brandId" value={brand.id} />
            <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
              <div className="field">
                <textarea name="text" rows={3} placeholder="Pega un post de la marca que represente bien su voz" required />
              </div>
              <SubmitButton className="btn">Añadir ejemplo</SubmitButton>
            </fieldset>
            <ul className="small">
              {examples.map((e) => (
                <li key={e.id}>
                  {e.text.slice(0, 160)} <span className="muted">· {fmt(e.createdAt, brand.timezone)}</span>
                </li>
              ))}
            </ul>
          </form>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Fuentes y referentes</h2>
            <p className="small">
              Referentes configurados: {brand.referents.length ? brand.referents.map((r) => `${r.platform}:${r.handle}`).join(', ') : 'ninguno'}
            </p>
            <p className="small muted">
              Fuentes: <SimBadge what="Demostración" /> RSS, Hacker News y GitHub se conectan en la fase 2. X y Reddit requieren verificar acceso y
              costes de API antes de activarse.
            </p>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Cuentas de publicación</h2>
            {accounts.map((a) => (
              <p key={a.id} className="small">
                X · @{a.handle} {a.mode === 'simulated' ? <SimBadge /> : <span className="badge ok">Real</span>}{' '}
                {a.mode === 'live' && !a.liveEnabled && <span className="badge warn">Envío real deshabilitado</span>}
              </p>
            ))}
            <p className="small muted">La publicación real en X se conecta en la fase 4 y queda desactivada hasta que el propietario la habilite.</p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Select({ name, label, value, options }: { name: string; label: string; value: string; options: Record<string, string> }) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={value}>
        {Object.entries(options).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </div>
  );
}

function ListField({ name, label, value, multiline }: { name: string; label: string; value: string[]; multiline?: boolean }) {
  return (
    <div className="field">
      <label htmlFor={name}>
        {label} <span className="hint">{multiline ? '(una por línea)' : '(separadas por comas)'}</span>
      </label>
      {multiline ? (
        <textarea id={name} name={name} rows={Math.max(2, value.length)} defaultValue={value.join('\n')} style={{ minHeight: 0 }} />
      ) : (
        <input id={name} name={name} defaultValue={value.join(', ')} />
      )}
    </div>
  );
}
