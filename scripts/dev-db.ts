/**
 * Postgres embebido para desarrollo (sin Docker ni instalación).
 * Datos en .data/pg. En producción se usa un Postgres gestionado vía DATABASE_URL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.data', 'pg');
const port = Number(process.env.DEV_DB_PORT ?? 54329);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'radar',
  password: 'radar',
  port,
  persistent: true,
  onLog: () => {},
  // Sin esto, en Windows el clúster hereda WIN1252 y rechaza emojis.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

const firstRun = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));
if (firstRun) await pg.initialise();
await pg.start();
if (firstRun) await pg.createDatabase('radar');

console.log(`Postgres de desarrollo listo en postgres://radar:radar@127.0.0.1:${port}/radar`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
