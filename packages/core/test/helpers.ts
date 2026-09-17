import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { loadConfig } from '../src/config';
import { createDb } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { ConsoleNotifier } from '../src/integrations/notifier/console';
import { SimulatedGenerator } from '../src/integrations/generator/simulated';
import { SimulatedXPublisher } from '../src/integrations/publisher/simulated-x';
import { createBrand } from '../src/modules/brands';
import { register, resolveActor, type Actor } from '../src/modules/identity';
import { simulateTelegramLink } from '../src/modules/notifications';
import { refreshRecommendations } from '../src/modules/radar';
import { seedDemo } from '../src/seed/demo';
import type { Services } from '../src/services';

export type TestEnv = Services & {
  notifier: ConsoleNotifier;
  publisher: SimulatedXPublisher;
  close(): Promise<void>;
};

/** Base de datos nueva y migrada para cada archivo de pruebas. */
export async function createTestEnv(): Promise<TestEnv> {
  const adminUrl = inject('adminUrl');
  const name = `t_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = adminUrl.replace(/\/postgres$/, `/${name}`);
  const { db, pool } = createDb(url);
  await runMigrations(db);
  const config = loadConfig({ DATABASE_URL: url, PUBLIC_BASE_URL: 'https://radar.test', DAILY_BUDGET_USD: '2' });
  const notifier = new ConsoleNotifier(() => {});
  const publisher = new SimulatedXPublisher(db);
  return {
    db,
    config,
    notifier,
    publisher,
    generator: new SimulatedGenerator(),
    close: () => pool.end(),
  };
}

let counter = 0;

/** Organización con marca, datos demo y (opcionalmente) Telegram vinculado. */
export async function createOrgWithBrand(
  env: TestEnv,
  opts: { exclusions?: string[]; linkTelegram?: boolean } = {},
): Promise<{ actor: Actor; brandId: string }> {
  counter++;
  const { user, org } = await register(env.db, {
    name: `Usuario ${counter}`,
    email: `u${counter}-${randomBytes(3).toString('hex')}@example.com`,
    password: 'contraseña-segura-123',
    orgName: `Org ${counter}`,
  });
  const actor = await resolveActor(env.db, user.id, org.id);
  const brand = await createBrand(env.db, actor, {
    name: 'Agencia Pulso',
    industry: 'marketing digital',
    offering: 'gestión de redes sociales para pymes',
    audience: 'community managers',
    interests: ['redes sociales', 'inteligencia artificial', 'automatización'],
    exclusions: opts.exclusions ?? ['apuestas', 'política'],
    xHandle: 'agenciapulso',
  });
  await seedDemo(env.db);
  await refreshRecommendations(env.db, brand.id);
  if (opts.linkTelegram !== false) await simulateTelegramLink(env, actor);
  return { actor, brandId: brand.id };
}

export const DEMO_EVENT_AI = '00000000-0000-4000-8000-00000000d001';
export const DEMO_EVENT_BETTING = '00000000-0000-4000-8000-00000000d005';
