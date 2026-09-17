import { createHash } from 'node:crypto';

/**
 * Huella de lo que una aprobación autoriza: texto, recursos y destino.
 * Cualquier cambio en estos campos produce otra huella e invalida la aprobación.
 */
export function contentHash(input: {
  text: string;
  assets: { url: string; alt: string }[];
  socialAccountId: string | null;
}): string {
  const canonical = JSON.stringify({
    t: input.text,
    a: input.assets.map((x) => [x.url, x.alt]),
    d: input.socialAccountId,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
