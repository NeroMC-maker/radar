import '../load-env';
import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { refreshAllBrands } from '../modules/runner';
import { loadConfig } from '../config';
import { createIntegrations } from '../integrations';
import { seedDemo } from './demo';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
await runMigrations(db);
const n = await seedDemo(db);
const brands = await refreshAllBrands({ db, config, ...createIntegrations(db, config) });
await pool.end();
console.log(`Datos de demostración cargados: ${n} acontecimientos. Recomendaciones recalculadas para ${brands} marca(s).`);
