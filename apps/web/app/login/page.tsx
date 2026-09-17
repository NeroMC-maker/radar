import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SubmitButton } from '@/components/client';
import { Flash } from '@/components/ui';
import { currentUser, safeNext } from '@/lib/server';
import { loginAction } from '@/app/actions';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === 'string' ? sp.next : null);
  if (await currentUser()) redirect(next);
  return (
    <main className="shell narrow">
      <h1>◎ Radar</h1>
      <p className="muted">Qué debería publicar hoy tu marca y por qué.</p>
      <Flash searchParams={sp} />
      <form action={loginAction} className="card">
        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label htmlFor="email">Correo</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <SubmitButton className="btn primary block" pending="Entrando…">
          Entrar
        </SubmitButton>
      </form>
      <p className="small">
        ¿No tienes cuenta? <Link href="/register">Crear cuenta</Link>
      </p>
    </main>
  );
}
