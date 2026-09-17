'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

/** Se desactiva mientras se envía: evita dobles pulsaciones (el backend también las tolera). */
export function SubmitButton({
  children,
  pending,
  className = 'btn',
  name,
  value,
}: {
  children: ReactNode;
  pending?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const status = useFormStatus();
  return (
    <button className={className} type="submit" disabled={status.pending} name={name} value={value}>
      {status.pending ? (pending ?? 'Procesando…') : children}
    </button>
  );
}

/** Refresca la página mientras un envío está en curso. */
export function AutoRefresh({ active, everyMs = 2000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}

/** Textarea con contador para el límite de X. */
export function PostEditor({ name, defaultValue, limit }: { name: string; defaultValue: string; limit: number }) {
  const [value, setValue] = useState(defaultValue);
  const over = value.length > limit;
  return (
    <div className="field">
      <textarea
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={8}
        aria-describedby="charcount"
        required
      />
      <div id="charcount" className={`small ${over ? '' : 'muted'}`} style={over ? { color: 'var(--danger)' } : undefined}>
        {value.length}/{limit} caracteres{over ? ' — demasiado largo para X' : ''}
      </div>
    </div>
  );
}

/** Muestra el formulario de programación solo cuando se pide. */
export function Reveal({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn block" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return <>{children}</>;
}
