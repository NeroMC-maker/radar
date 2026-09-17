import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, DbOrTx } from '../db/client';
import { approvedExamples, brands, socialAccounts, voiceVersions, type VoiceTraits } from '../db/schema';
import { isValidTimeZone } from '../domain/time';
import { notFound } from '../errors';
import { audit } from './audit';
import { requireCap, type Actor } from './identity';
import { enqueueJob } from './jobs';

const list = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(/[,\n]/)).map((s) => s.trim()).filter(Boolean).slice(0, 50));

export const brandSchema = z.object({
  name: z.string().trim().min(1, 'Escribe el nombre de la marca').max(100),
  description: z.string().trim().max(2000).default(''),
  industry: z.string().trim().max(200).default(''),
  offering: z.string().trim().max(1000).default(''),
  audience: z.string().trim().max(500).default(''),
  market: z.string().trim().max(200).default(''),
  language: z.string().trim().min(2).max(10).default('es'),
  timezone: z.string().trim().refine(isValidTimeZone, 'Zona horaria inválida').default('America/Lima'),
  goals: z.string().trim().max(1000).default(''),
  positioning: z.string().trim().max(2000).default(''),
  interests: list.default([]),
  exclusions: list.default([]),
  /** "x:usuario" por línea: identidades explícitas por plataforma */
  referents: list
    .default([])
    .transform((items) =>
      items
        .map((s) => /^([a-z]+):@?([\w.-]+)$/i.exec(s))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => ({ platform: m[1]!.toLowerCase(), handle: m[2]! })),
    ),
  xHandle: z
    .string()
    .trim()
    .regex(/^@?\w{1,15}$/, 'Usuario de X inválido')
    .transform((h) => h.replace(/^@/, '')),
});

export const DEFAULT_VOICE: VoiceTraits = {
  formality: 'neutral',
  technicalLevel: 'intermediate',
  length: 'short',
  emojis: 'few',
  phrases: [],
  forbiddenWords: [],
  openings: [],
  closings: [],
  ctaPreference: 'Invitar a leer la fuente',
};

export async function createBrand(db: Db, actor: Actor, raw: z.input<typeof brandSchema>) {
  requireCap(actor, 'brand.configure');
  const { xHandle, ...input } = brandSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [brand] = await tx
      .insert(brands)
      .values({ ...input, orgId: actor.orgId })
      .returning();
    await tx.insert(voiceVersions).values({
      orgId: actor.orgId,
      brandId: brand!.id,
      version: 1,
      traits: DEFAULT_VOICE,
      createdBy: actor.userId,
    });
    // Cuenta de X en modo simulado: el envío real requiere conexión y habilitación explícita (fase 4).
    await tx.insert(socialAccounts).values({
      orgId: actor.orgId,
      brandId: brand!.id,
      platform: 'x',
      handle: xHandle,
      mode: 'simulated',
      liveEnabled: false,
    });
    await audit(tx, { orgId: actor.orgId, userId: actor.userId, action: 'brand.created', entity: 'brand', entityId: brand!.id });
    await enqueueJob(tx, {
      kind: 'refresh_recommendations',
      orgId: actor.orgId,
      payload: { brandId: brand!.id },
    });
    return brand!;
  });
}

export async function updateBrand(db: Db, actor: Actor, brandId: string, raw: z.input<typeof brandSchema>) {
  requireCap(actor, 'brand.configure');
  const { xHandle, ...input } = brandSchema.parse(raw);
  await db.transaction(async (tx) => {
    const brand = await getBrand(tx, actor, brandId);
    await tx.update(brands).set({ ...input, updatedAt: new Date() }).where(eq(brands.id, brand.id));
    await tx
      .update(socialAccounts)
      .set({ handle: xHandle })
      .where(and(eq(socialAccounts.brandId, brand.id), eq(socialAccounts.platform, 'x'), eq(socialAccounts.mode, 'simulated')));
    await audit(tx, { orgId: actor.orgId, userId: actor.userId, action: 'brand.updated', entity: 'brand', entityId: brand.id });
    await enqueueJob(tx, { kind: 'refresh_recommendations', orgId: actor.orgId, payload: { brandId: brand.id } });
  });
}

/** Siempre filtra por organización: una marca ajena responde "no encontrada". */
export async function getBrand(db: DbOrTx, actor: Actor, brandId: string) {
  requireCap(actor, 'brand.read');
  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.orgId, actor.orgId)));
  if (!brand) throw notFound('Marca no encontrada');
  return brand;
}

export async function listBrands(db: DbOrTx, actor: Actor) {
  requireCap(actor, 'brand.read');
  return db.select().from(brands).where(eq(brands.orgId, actor.orgId)).orderBy(brands.createdAt);
}

export async function brandAccounts(db: DbOrTx, actor: Actor, brandId: string) {
  await getBrand(db, actor, brandId);
  return db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.brandId, brandId), eq(socialAccounts.orgId, actor.orgId)));
}

export async function currentVoice(db: DbOrTx, actor: Actor, brandId: string) {
  await getBrand(db, actor, brandId);
  const [v] = await db
    .select()
    .from(voiceVersions)
    .where(and(eq(voiceVersions.brandId, brandId), eq(voiceVersions.orgId, actor.orgId)))
    .orderBy(desc(voiceVersions.version))
    .limit(1);
  if (!v) throw notFound('La marca no tiene voz configurada');
  return v;
}

export const voiceSchema = z.object({
  formality: z.enum(['informal', 'neutral', 'formal']),
  technicalLevel: z.enum(['basic', 'intermediate', 'expert']),
  length: z.enum(['short', 'medium', 'long']),
  emojis: z.enum(['none', 'few', 'many']),
  phrases: list.default([]),
  forbiddenWords: list.default([]),
  openings: list.default([]),
  closings: list.default([]),
  ctaPreference: z.string().trim().max(300).default(''),
});

/** Cada cambio crea una versión nueva; los borradores guardan la versión que usaron. */
export async function saveVoice(db: Db, actor: Actor, brandId: string, raw: z.input<typeof voiceSchema>) {
  requireCap(actor, 'brand.configure');
  const traits = voiceSchema.parse(raw);
  return db.transaction(async (tx) => {
    const prev = await currentVoice(tx, actor, brandId);
    const [v] = await tx
      .insert(voiceVersions)
      .values({ orgId: actor.orgId, brandId, version: prev.version + 1, traits, createdBy: actor.userId })
      .returning();
    await audit(tx, { orgId: actor.orgId, userId: actor.userId, action: 'voice.updated', entity: 'brand', entityId: brandId, data: { version: v!.version } });
    return v!;
  });
}

export async function addApprovedExample(db: Db, actor: Actor, brandId: string, text: string) {
  requireCap(actor, 'brand.configure');
  await getBrand(db, actor, brandId);
  const clean = text.trim().slice(0, 2000);
  if (!clean) return;
  await db.insert(approvedExamples).values({ orgId: actor.orgId, brandId, text: clean });
}

export async function listApprovedExamples(db: DbOrTx, actor: Actor, brandId: string) {
  await getBrand(db, actor, brandId);
  return db
    .select()
    .from(approvedExamples)
    .where(and(eq(approvedExamples.brandId, brandId), eq(approvedExamples.orgId, actor.orgId)))
    .orderBy(desc(approvedExamples.createdAt));
}
