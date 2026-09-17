/**
 * Trabajador en segundo plano:
 * - publica las versiones aprobadas (inmediatas y programadas),
 * - entrega notificaciones,
 * - vincula teléfonos con Telegram (long polling),
 * - recalcula recomendaciones periódicamente,
 * - recupera trabajo interrumpido tras un reinicio.
 */
import '@radar/core/load-env';
import { hostname } from 'node:os';
import {
  createDb,
  createIntegrations,
  integrationStatus,
  loadConfig,
  notificationsModule,
  publicationsModule,
  runMigrations,
  runner,
  type Services,
} from '@radar/core';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
// En desarrollo la base de datos arranca a la vez que el worker: se espera a que responda.
for (let i = 1; ; i++) {
  try {
    await pool.query('select 1');
    break;
  } catch (e) {
    if (i >= 60) throw e;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
await runMigrations(db);
const svc: Services = { db, config, ...createIntegrations(db, config) };
const workerId = `${hostname()}:${process.pid}`;

console.log('Worker iniciado. Integraciones:');
for (const s of integrationStatus(config)) console.log(`  · ${s.name}: ${s.state.toUpperCase()} — ${s.detail}`);

let running = true;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loop(name: string, fn: () => Promise<boolean>, idleMs: number) {
  while (running) {
    try {
      const didWork = await fn();
      if (!didWork) await sleep(idleMs);
    } catch (e) {
      console.error(`[${name}]`, e);
      await sleep(Math.max(idleMs, 5_000));
    }
  }
}

const recovered = await runner.recoverAfterRestart(svc);
if (recovered) console.log(`Recuperadas ${recovered} publicación(es) interrumpida(s).`);

const loops = [
  loop('publicaciones', () => publicationsModule.processNextPublication(svc, workerId), 2_000),
  loop('trabajos', () => runner.processNextJob(svc, workerId), 1_000),
  // getUpdates espera hasta 20 s por mensajes nuevos; en modo simulado vuelve al instante.
  loop('telegram', async () => (await notificationsModule.processTelegramLinks(svc)) > 0, svc.notifier.live ? 0 : 3_000),
  loop(
    'mantenimiento',
    async () => {
      await runner.recoverAfterRestart(svc);
      await runner.refreshAllBrands(svc);
      return false;
    },
    5 * 60_000,
  ),
];

const shutdown = async () => {
  if (!running) return;
  running = false;
  console.log('Deteniendo worker…');
  // Deja terminar el ciclo en curso (un envío a medias se resuelve en el próximo arranque).
  await Promise.race([Promise.all(loops), sleep(25_000)]);
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
