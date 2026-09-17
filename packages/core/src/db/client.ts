import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
/** Transacción o conexión: las funciones de dominio aceptan cualquiera de las dos. */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(url: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return { db: drizzle(pool, { schema }), pool };
}

const globalForDb = globalThis as unknown as { __radarDb?: { db: Db; pool: pg.Pool } };

/** Conexión compartida por proceso (sobrevive a recargas en desarrollo). */
export function getDb(): Db {
  if (!globalForDb.__radarDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL no está configurada');
    globalForDb.__radarDb = createDb(url);
  }
  return globalForDb.__radarDb.db;
}

export { schema };
