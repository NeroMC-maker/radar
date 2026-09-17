'use client';

import { useActionState, useState } from 'react';
import type { VoiceProposal } from '@radar/core';
import { SubmitButton } from '@/components/client';
import { analyzeVoiceAction, confirmVoiceAction, type AnalyzeState } from './actions';

type Exercise = { title: string; prompt: string; placeholder: string };

const LABELS = {
  formality: { informal: 'Cercano / informal', neutral: 'Neutral', formal: 'Formal' },
  technicalLevel: { basic: 'Cotidiano', intermediate: 'Intermedio', expert: 'Técnico' },
  length: { short: 'Corto', medium: 'Medio', long: 'Largo' },
  emojis: { none: 'Sin emojis', few: 'Pocos emojis', many: 'Muchos emojis' },
  addressForm: { '': 'Sin preferencia', tu: 'Tuteas (tú)', usted: 'De usted', mixed: 'Mezclas tú y usted' },
  exclamations: { none: 'Sin exclamaciones', some: 'Algunas exclamaciones', many: 'Muchas exclamaciones' },
} as const;

export function VoiceWizard({ brandId, brandName, exercises }: { brandId: string; brandName: string; exercises: Exercise[] }) {
  const [state, formAction, pending] = useActionState<AnalyzeState, FormData>(analyzeVoiceAction, { status: 'idle' });
  const [editing, setEditing] = useState(false);

  if (state.status === 'proposal' && !editing) {
    return <Proposal brandId={brandId} brandName={brandName} proposal={state.proposal} samples={state.samples} onBack={() => setEditing(true)} />;
  }

  const previous = state.status === 'idle' ? [] : state.samples;

  return (
    <form
      action={(fd) => {
        setEditing(false);
        formAction(fd);
      }}
    >
      {state.status === 'error' && (
        <div className="flash error" role="alert">
          {state.message}
        </div>
      )}
      {exercises.map((ex, i) => (
        <div key={ex.title} className="card">
          <div className="row between">
            <h3 style={{ margin: 0 }}>
              {i + 1}. {ex.title}
            </h3>
            <span className="small muted">Escribe como lo harías en tus redes</span>
          </div>
          <p className="small" style={{ margin: '6px 0 10px' }}>
            {ex.prompt}
          </p>
          <textarea name="sample" rows={4} placeholder={ex.placeholder} defaultValue={previous[i] ?? ''} maxLength={2000} />
        </div>
      ))}
      <div className="card">
        <h3 style={{ margin: 0 }}>Opcional: pega publicaciones reales</h3>
        <p className="small muted" style={{ margin: '6px 0 10px' }}>
          Copia posts que ya hayas publicado y te representen. Sepáralos con una línea que solo tenga <span className="mono">---</span>.
        </p>
        <textarea
          name="pasted"
          rows={6}
          defaultValue={previous.slice(exercises.length).join('\n---\n')}
          placeholder={'Primer post…\n---\nSegundo post…'}
        />
      </div>
      <button className="btn primary block big" type="submit" disabled={pending}>
        {pending ? 'Analizando tu estilo…' : 'Analizar cómo escribo'}
      </button>
      <p className="small muted" style={{ marginTop: 8 }}>
        Análisis por reglas, sin IA: revisarás el resultado antes de guardarlo.
      </p>
    </form>
  );
}

function Proposal({
  brandId,
  brandName,
  proposal,
  samples,
  onBack,
}: {
  brandId: string;
  brandName: string;
  proposal: VoiceProposal;
  samples: string[];
  onBack: () => void;
}) {
  const t = proposal.traits;
  const ev = proposal.evidence;
  const low = proposal.confidence < 0.5;

  return (
    <form action={confirmVoiceAction}>
      <input type="hidden" name="brandId" value={brandId} />
      <input type="hidden" name="samples" value={JSON.stringify(samples)} />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Así escribes para {brandName}</h2>
        <p className="small muted">
          Basado en {proposal.stats.texts} texto(s) y {proposal.stats.words} palabras. Confianza {Math.round(proposal.confidence * 100)}%.
        </p>
        {low && <div className="notice">Hay poco texto: revisa bien cada rasgo o vuelve y escribe un poco más.</div>}
        <p className="small">Revisa cada rasgo y corrígelo si no te representa. Nada se guarda hasta que confirmes.</p>
      </div>

      <div className="grid grid-2">
        <Trait label="Tono" evidence={ev.formality}>
          <Select name="formality" value={t.formality} options={LABELS.formality} />
        </Trait>
        <Trait label="Trato al lector" evidence={ev.addressForm ?? 'No se detectó un trato claro'}>
          <Select name="addressForm" value={t.addressForm ?? ''} options={LABELS.addressForm} />
        </Trait>
        <Trait label="Emojis" evidence={ev.emojis}>
          <Select name="emojis" value={t.emojis} options={LABELS.emojis} />
        </Trait>
        <Trait label="Longitud" evidence={ev.length}>
          <Select name="length" value={t.length} options={LABELS.length} />
        </Trait>
        <Trait label="Nivel técnico" evidence={ev.technicalLevel}>
          <Select name="technicalLevel" value={t.technicalLevel} options={LABELS.technicalLevel} />
        </Trait>
        <Trait label="Exclamaciones" evidence={undefined}>
          <Select name="exclamations" value={t.exclamations ?? 'none'} options={LABELS.exclamations} />
        </Trait>
        <Trait label="Cómo empiezas" evidence={ev.openings ?? 'No se detectó una apertura habitual'}>
          <Lines name="openings" value={t.openings} placeholder="¡Hola, comunidad!" />
        </Trait>
        <Trait label="Cómo cierras" evidence={ev.closings ?? 'No se detectó un cierre habitual'}>
          <Lines name="closings" value={t.closings} placeholder="¡Nos vemos!" />
        </Trait>
        <Trait label="Expresiones que repites" evidence={ev.phrases ?? 'No se repitieron expresiones entre textos'}>
          <Lines name="phrases" value={t.phrases} />
        </Trait>
        <Trait label="Hashtags habituales" evidence={ev.hashtags ?? 'No usas hashtags'}>
          <input name="hashtags" defaultValue={(t.hashtags ?? []).join(', ')} placeholder="#TuMarca" />
        </Trait>
        <Trait label="Llamada a la acción" evidence={ev.ctaPreference}>
          <input name="ctaPreference" defaultValue={t.ctaPreference} />
        </Trait>
        <Trait label="Palabras que nunca usarías" evidence="Esto no se puede deducir: complétalo tú">
          <input name="forbiddenWords" defaultValue={t.forbiddenWords.join(', ')} placeholder="barato, gratis…" />
        </Trait>
      </div>

      <details className="card">
        <summary>Textos que se guardarán como ejemplos ({samples.length})</summary>
        {samples.map((s, i) => (
          <pre key={i} className="post small" style={{ marginTop: 8 }}>
            {s}
          </pre>
        ))}
      </details>

      <div className="actionbar stack">
        <SubmitButton className="btn primary block big" pending="Guardando…">
          Sí, así escribo: guardar mi voz
        </SubmitButton>
        <button type="button" className="btn block" onClick={onBack}>
          Volver a escribir
        </button>
      </div>
    </form>
  );
}

function Trait({ label, evidence, children }: { label: string; evidence?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      {children}
      {evidence && <div className="small muted" style={{ marginTop: 6 }}>{evidence}</div>}
    </div>
  );
}

/** Una entrada por línea: las aperturas y cierres pueden llevar comas. */
function Lines({ name, value, placeholder }: { name: string; value: string[]; placeholder?: string }) {
  return <textarea name={name} rows={Math.max(2, value.length)} defaultValue={value.join('\n')} placeholder={placeholder} style={{ minHeight: 0 }} />;
}

function Select({ name, value, options }: { name: string; value: string; options: Record<string, string> }) {
  return (
    <select name={name} defaultValue={value}>
      {Object.entries(options).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}
