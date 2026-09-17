import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client';
import { simulatedPosts } from '../../db/schema';
import type { LookupResult, PublishRequest, PublishResult, Publisher } from './types';

export type SimulatedFailure = 'none' | 'error' | 'timeout_created' | 'timeout_not_created' | 'lookup_unavailable';

/**
 * Publicador SIMULADO de X: guarda el post en la tabla simulated_posts, nada sale a internet.
 * Permite inyectar fallos para probar reintentos y resultados ambiguos.
 */
export class SimulatedXPublisher implements Publisher {
  readonly platform = 'x';
  readonly live = false;
  failure: SimulatedFailure = 'none';

  constructor(private readonly db: DbOrTx) {}

  async checkAccount(): Promise<{ ok: true }> {
    return { ok: true };
  }

  private async store(req: PublishRequest) {
    const [row] = await this.db
      .insert(simulatedPosts)
      .values({ platform: 'x', handle: req.account.handle, idempotencyKey: req.idempotencyKey, text: req.text })
      .onConflictDoNothing()
      .returning();
    return row ?? (await this.find(req.idempotencyKey));
  }

  private async find(key: string) {
    const [row] = await this.db.select().from(simulatedPosts).where(eq(simulatedPosts.idempotencyKey, key));
    return row;
  }

  private urlFor(handle: string, id: string) {
    return `https://x.com/${handle.replace(/^@/, '')}/status/sim-${id}`;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    if (req.text.length > 280) {
      return { outcome: 'failed', error: 'El texto supera 280 caracteres', retryable: false };
    }
    switch (this.failure) {
      case 'error':
        return { outcome: 'failed', error: 'Error simulado 503', retryable: true };
      case 'timeout_created':
        await this.store(req);
        return { outcome: 'ambiguous', error: 'Timeout simulado (el post sí se creó)' };
      case 'timeout_not_created':
      case 'lookup_unavailable':
        return { outcome: 'ambiguous', error: 'Timeout simulado' };
    }
    const row = await this.store(req);
    if (!row) return { outcome: 'ambiguous', error: 'No se pudo leer el post simulado' };
    return { outcome: 'success', externalId: `sim-${row.id}`, externalUrl: this.urlFor(req.account.handle, row.id) };
  }

  async lookup(req: PublishRequest): Promise<LookupResult> {
    if (this.failure === 'lookup_unavailable') return { found: 'unknown', reason: 'Consulta simulada no disponible' };
    const row = await this.find(req.idempotencyKey);
    return row
      ? { found: true, externalId: `sim-${row.id}`, externalUrl: this.urlFor(req.account.handle, row.id) }
      : { found: false };
  }
}
