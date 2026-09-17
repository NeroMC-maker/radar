import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="shell narrow">
      <div className="card empty">
        <p>
          <strong>No encontrado</strong>
        </p>
        <Link className="btn" href="/radar">
          Ir al radar
        </Link>
      </div>
    </main>
  );
}
