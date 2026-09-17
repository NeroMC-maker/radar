import Link from 'next/link';
import { SubmitButton } from '@/components/client';
import { Flash } from '@/components/ui';
import { registerAction } from '@/app/actions';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function RegisterPage({ searchParams }: Props) {
  const sp = await searchParams;
  return (
    <main className="shell narrow">
      <h1>Crear cuenta</h1>
      <p className="muted">Recibirás los roles de propietario, editor y aprobador: puedes completar todo el flujo sin invitar a nadie.</p>
      <Flash searchParams={sp} />
      <form action={registerAction} className="card">
        <div className="field">
          <label htmlFor="name">Tu nombre</label>
          <input id="name" name="name" autoComplete="name" required />
        </div>
        <div className="field">
          <label htmlFor="orgName">
            Organización <span className="hint">(tu agencia o tu nombre si eres freelancer)</span>
          </label>
          <input id="orgName" name="orgName" required />
        </div>
        <div className="field">
          <label htmlFor="email">Correo</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="field">
          <label htmlFor="password">
            Contraseña <span className="hint">(mínimo 10 caracteres)</span>
          </label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        </div>
        <SubmitButton className="btn primary block" pending="Creando…">
          Crear cuenta
        </SubmitButton>
      </form>
      <p className="small">
        ¿Ya tienes cuenta? <Link href="/login">Entrar</Link>
      </p>
    </main>
  );
}
