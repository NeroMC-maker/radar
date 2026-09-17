import '../load-env';
import { createDb } from './client';
import { runMigrations } from './migrate';

const { db, pool } = createDb(process.env.DATABASE_URL!);
await runMigrations(db);
await pool.end();
console.log('Migraciones aplicadas.');
