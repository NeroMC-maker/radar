import type { AppConfig } from './config';
import type { Db } from './db/client';
import type { Integrations } from './integrations';

/** Dependencias de los casos de uso: base de datos, integraciones y configuración. */
export type Services = Integrations & { db: Db; config: AppConfig };
