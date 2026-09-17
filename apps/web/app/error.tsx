'use client';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="shell narrow">
      <div className="card empty" role="alert">
        <p>
          <strong>Algo salió mal</strong>
        </p>
        <p>No pudimos cargar esta pantalla. Si el problema sigue, revisa que la base de datos y el worker estén en marcha.</p>
        <button className="btn primary" onClick={reset}>
          Reintentar
        </button>
      </div>
    </main>
  );
}
