import { eq } from 'drizzle-orm';
import type { AppConfig } from '../config';
import type { Db } from '../db/client';
import { systemState } from '../db/schema';
import type { ContentGenerator } from './generator/types';
import { SimulatedGenerator } from './generator/simulated';
import { ConsoleNotifier } from './notifier/console';
import { TelegramNotifier } from './notifier/telegram';
import type { Notifier } from './notifier/types';
import { SimulatedXPublisher } from './publisher/simulated-x';
import type { Publisher } from './publisher/types';

export type Integrations = {
  notifier: Notifier;
  publisher: Publisher;
  generator: ContentGenerator;
};

export type IntegrationStatus = { name: string; state: 'real' | 'simulada' | 'pendiente'; detail: string };

export function createIntegrations(db: Db, config: AppConfig): Integrations {
  const notifier: Notifier = config.TELEGRAM_BOT_TOKEN
    ? new TelegramNotifier(config.TELEGRAM_BOT_TOKEN, {
        async get() {
          const [row] = await db.select().from(systemState).where(eq(systemState.key, 'telegram_offset'));
          return typeof row?.value === 'number' ? row.value : 0;
        },
        async set(v) {
          await db
            .insert(systemState)
            .values({ key: 'telegram_offset', value: v })
            .onConflictDoUpdate({ target: systemState.key, set: { value: v, updatedAt: new Date() } });
        },
      })
    : new ConsoleNotifier();

  // La publicación real en X todavía no está implementada (fase 4): siempre simulada.
  const publisher: Publisher = new SimulatedXPublisher(db);

  // Claude se conecta en la fase 3.
  const generator: ContentGenerator = new SimulatedGenerator();

  return { notifier, publisher, generator };
}

export function integrationStatus(config: AppConfig): IntegrationStatus[] {
  return [
    config.TELEGRAM_BOT_TOKEN
      ? { name: 'Notificaciones (Telegram)', state: 'real', detail: 'Bot configurado' }
      : { name: 'Notificaciones (Telegram)', state: 'simulada', detail: 'Falta TELEGRAM_BOT_TOKEN en .env' },
    {
      name: 'Publicación en X',
      state: 'simulada',
      detail: 'Los posts se guardan localmente. Envío real: fase 4 (requiere API de X y autorización del propietario).',
    },
    {
      name: 'Generación de contenido',
      state: 'simulada',
      detail: 'Plantillas sin IA. Claude se conecta en la fase 3 con ANTHROPIC_API_KEY.',
    },
    { name: 'Fuentes (RSS, Hacker News, GitHub)', state: 'pendiente', detail: 'Fase 2. Hoy se usan señales de demostración.' },
    { name: 'Fuentes (X, Reddit)', state: 'pendiente', detail: 'Requieren verificar acceso y costes de API.' },
  ];
}

export { ConsoleNotifier, SimulatedGenerator, SimulatedXPublisher, TelegramNotifier };
export type { ContentGenerator, Notifier, Publisher };
