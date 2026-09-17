export type PublishRequest = {
  idempotencyKey: string;
  account: { platform: string; handle: string; credentialsRef: string | null };
  text: string;
  assets: { url: string; alt: string }[];
};

export type PublishResult =
  | { outcome: 'success'; externalId: string; externalUrl: string; raw?: Record<string, unknown> }
  /** Fallo definitivo conocido: el post NO se creó */
  | { outcome: 'failed'; error: string; retryable: boolean; raw?: Record<string, unknown> }
  /** No se sabe si se creó (timeout, conexión cortada) */
  | { outcome: 'ambiguous'; error: string };

export type LookupResult =
  | { found: true; externalId: string; externalUrl: string }
  | { found: false }
  /** No se puede comprobar: no reintentar automáticamente */
  | { found: 'unknown'; reason: string };

export interface Publisher {
  readonly platform: string;
  /** true = publica en la red real */
  readonly live: boolean;
  /** Verifica credenciales y permisos antes de enviar */
  checkAccount(account: PublishRequest['account']): Promise<{ ok: true } | { ok: false; error: string }>;
  publish(req: PublishRequest): Promise<PublishResult>;
  /** Comprueba si una publicación con esa clave ya existe (tras un resultado ambiguo) */
  lookup(req: PublishRequest): Promise<LookupResult>;
}
