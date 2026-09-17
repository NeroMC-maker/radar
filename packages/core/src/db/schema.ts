import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const orgId = () => uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' });

/* ─────────────── Acceso ─────────────── */

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
});

/** roles: subconjunto de 'owner' | 'editor' | 'approver' */
export const memberships = pgTable(
  'memberships',
  {
    orgId: orgId(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    roles: text('roles').array().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

/** Se guarda el hash del token, nunca el token. */
export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/* ─────────────── Marca ─────────────── */

export const brands = pgTable(
  'brands',
  {
    id: id(),
    orgId: orgId(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    industry: text('industry').notNull().default(''),
    offering: text('offering').notNull().default(''),
    audience: text('audience').notNull().default(''),
    market: text('market').notNull().default(''),
    language: text('language').notNull().default('es'),
    timezone: text('timezone').notNull().default('America/Lima'),
    goals: text('goals').notNull().default(''),
    positioning: text('positioning').notNull().default(''),
    interests: text('interests').array().notNull().default(sql`'{}'::text[]`),
    exclusions: text('exclusions').array().notNull().default(sql`'{}'::text[]`),
    /** [{ platform, handle, label }] — identidades explícitas por plataforma */
    referents: jsonb('referents').$type<Referent[]>().notNull().default([]),
    /** Reglas de generación automática (fase 3) */
    autoGeneration: jsonb('auto_generation').$type<AutoGenerationRules>().notNull().default({
      enabled: false,
      minPriority: 70,
      minConfidence: 0.6,
      dailyLimit: 3,
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('brands_org_idx').on(t.orgId)],
);

export type Referent = { platform: string; handle: string; label?: string };
export type AutoGenerationRules = {
  enabled: boolean;
  minPriority: number;
  minConfidence: number;
  dailyLimit: number;
};

export type VoiceTraits = {
  formality: 'informal' | 'neutral' | 'formal';
  technicalLevel: 'basic' | 'intermediate' | 'expert';
  length: 'short' | 'medium' | 'long';
  emojis: 'none' | 'few' | 'many';
  phrases: string[];
  forbiddenWords: string[];
  openings: string[];
  closings: string[];
  ctaPreference: string;
};

export const voiceVersions = pgTable(
  'voice_versions',
  {
    id: id(),
    orgId: orgId(),
    brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    traits: jsonb('traits').$type<VoiceTraits>().notNull(),
    /** Rasgos inferidos pendientes de validar por el usuario */
    inferred: boolean('inferred').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('voice_versions_brand_version').on(t.brandId, t.version)],
);

export const approvedExamples = pgTable('approved_examples', {
  id: id(),
  orgId: orgId(),
  brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  channel: text('channel').notNull().default('x'),
  createdAt: createdAt(),
});

/* ─────────────── Monitorización ─────────────── */

/** org_id nulo = fuente compartida (pública). */
export const sources = pgTable('sources', {
  id: id(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // rss | hackernews | github | x | reddit | demo
  name: text('name').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  intervalMinutes: integer('interval_minutes').notNull().default(30),
  enabled: boolean('enabled').notNull().default(true),
  cursor: jsonb('cursor').$type<Record<string, unknown>>(),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: createdAt(),
});

export const collectionRuns = pgTable('collection_runs', {
  id: id(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  /** ok_with_results | ok_empty | access_error | error */
  outcome: text('outcome'),
  itemsFound: integer('items_found').notNull().default(0),
  error: text('error'),
});

/* ─────────────── Señales ─────────────── */

export const signals = pgTable(
  'signals',
  {
    id: id(),
    /** nulo = capa compartida */
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    platform: text('platform').notNull(),
    externalId: text('external_id').notNull(),
    url: text('url'),
    author: text('author'),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    language: text('language'),
    entities: text('entities').array().notNull().default(sql`'{}'::text[]`),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
    /** { retentionDays, aiUseAllowed, storeContent } */
    usageRestrictions: jsonb('usage_restrictions').$type<Record<string, unknown>>().notNull().default({}),
    isDemo: boolean('is_demo').notNull().default(false),
    deletedAtSource: timestamp('deleted_at_source', { withTimezone: true }),
  },
  (t) => [uniqueIndex('signals_platform_external').on(t.platform, t.externalId)],
);

/** Observaciones históricas de engagement. Métrica ausente = clave ausente, nunca 0. */
export const signalMeasurements = pgTable(
  'signal_measurements',
  {
    id: id(),
    signalId: uuid('signal_id').notNull().references(() => signals.id, { onDelete: 'cascade' }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    metrics: jsonb('metrics').$type<Record<string, number>>().notNull(),
  },
  (t) => [index('signal_measurements_signal_idx').on(t.signalId, t.observedAt)],
);

/* ─────────────── Acontecimientos ─────────────── */

export const events = pgTable('events', {
  id: id(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  kind: text('kind').notNull().default('other'), // launch | release | adoption | news | other
  topics: text('topics').array().notNull().default(sql`'{}'::text[]`),
  language: text('language'),
  isDemo: boolean('is_demo').notNull().default(false),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: updatedAt(),
});

export const eventSignals = pgTable(
  'event_signals',
  {
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    signalId: uuid('signal_id').notNull().references(() => signals.id, { onDelete: 'cascade' }),
    /** original | syndicated | independent */
    relation: text('relation').notNull().default('independent'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.signalId] })],
);

/** Registro de uniones/separaciones manuales de agrupaciones. */
export const eventCorrections = pgTable('event_corrections', {
  id: id(),
  action: text('action').notNull(), // merge | split
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  userId: uuid('user_id').references(() => users.id),
  createdAt: createdAt(),
});

export type EvidenceClaim = { text: string; sourceUrls: string[] };
export type EvidenceSource = { url: string; title: string; platform: string; isOriginal: boolean };

export const evidenceVersions = pgTable(
  'evidence_versions',
  {
    id: id(),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    whatHappened: text('what_happened').notNull(),
    confirmed: jsonb('confirmed').$type<EvidenceClaim[]>().notNull().default([]),
    uncertain: jsonb('uncertain').$type<EvidenceClaim[]>().notNull().default([]),
    sources: jsonb('sources').$type<EvidenceSource[]>().notNull().default([]),
    participants: text('participants').array().notNull().default(sql`'{}'::text[]`),
    perspectives: jsonb('perspectives').$type<EvidenceClaim[]>().notNull().default([]),
    /** true cuando la evidencia no alcanza para afirmar el hecho */
    insufficient: boolean('insufficient').notNull().default(false),
    /** true si esta versión corrige materialmente la anterior */
    materialChange: boolean('material_change').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('evidence_event_version').on(t.eventId, t.version)],
);

/* ─────────────── Recomendaciones ─────────────── */

export const trendEvaluations = pgTable(
  'trend_evaluations',
  {
    id: id(),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    weightsVersion: text('weights_version').notNull(),
    strength: numeric('strength', { mode: 'number' }).notNull(),
    confidence: numeric('confidence', { mode: 'number' }).notNull(),
    /** rising | stable | fading | unknown */
    direction: text('direction').notNull(),
    factors: jsonb('factors').$type<Record<string, unknown>>().notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('trend_eval_event_idx').on(t.eventId, t.computedAt)],
);

export const recommendations = pgTable(
  'recommendations',
  {
    id: id(),
    orgId: orgId(),
    brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    trendEvaluationId: uuid('trend_evaluation_id').references(() => trendEvaluations.id),
    /** Índice 0–100, NO es una probabilidad */
    affinity: numeric('affinity', { mode: 'number' }).notNull(),
    priority: numeric('priority', { mode: 'number' }).notNull(),
    factors: jsonb('factors').$type<Record<string, unknown>>().notNull(),
    whyItMatters: text('why_it_matters').notNull().default(''),
    /** open | dismissed | used */
    status: text('status').notNull().default('open'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('recommendations_brand_event').on(t.brandId, t.eventId)],
);

/* ─────────────── Publicación: cuentas ─────────────── */

export const socialAccounts = pgTable('social_accounts', {
  id: id(),
  orgId: orgId(),
  brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(), // x
  handle: text('handle').notNull(),
  /** simulated | live */
  mode: text('mode').notNull().default('simulated'),
  /** Interruptor explícito del propietario para permitir envíos reales */
  liveEnabled: boolean('live_enabled').notNull().default(false),
  /** Referencia al secreto (nunca el token en claro) */
  credentialsRef: text('credentials_ref'),
  /** connected | expired | revoked */
  status: text('status').notNull().default('connected'),
  createdAt: createdAt(),
});

/* ─────────────── Contenido ─────────────── */

export const drafts = pgTable(
  'drafts',
  {
    id: id(),
    orgId: orgId(),
    brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    recommendationId: uuid('recommendation_id').references(() => recommendations.id, { onDelete: 'set null' }),
    channel: text('channel').notNull().default('x'),
    socialAccountId: uuid('social_account_id').references(() => socialAccounts.id),
    /** ver domain/draft-states.ts */
    status: text('status').notNull().default('draft'),
    currentVersionId: uuid('current_version_id'),
    origin: text('origin').notNull().default('manual'), // manual | auto
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('drafts_org_status_idx').on(t.orgId, t.status)],
);

export const draftVersions = pgTable(
  'draft_versions',
  {
    id: id(),
    orgId: orgId(),
    draftId: uuid('draft_id').notNull().references(() => drafts.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    text: text('text').notNull(),
    assets: jsonb('assets').$type<{ url: string; alt: string }[]>().notNull().default([]),
    references: jsonb('references').$type<{ url: string; title: string }[]>().notNull().default([]),
    angle: text('angle').notNull().default(''),
    mode: text('mode').notNull().default('informative'),
    reviewNotes: jsonb('review_notes').$type<string[]>().notNull().default([]),
    evidenceVersionId: uuid('evidence_version_id').references(() => evidenceVersions.id),
    voiceVersionId: uuid('voice_version_id').references(() => voiceVersions.id),
    /** simulated | claude:<modelo> | human */
    generator: text('generator').notNull(),
    /** hash de texto + recursos + destino: lo que autoriza una aprobación */
    contentHash: text('content_hash').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('draft_versions_number').on(t.draftId, t.number)],
);

/* ─────────────── Aprobación ─────────────── */

export const approvals = pgTable('approvals', {
  id: id(),
  orgId: orgId(),
  draftId: uuid('draft_id').notNull().references(() => drafts.id, { onDelete: 'cascade' }),
  draftVersionId: uuid('draft_version_id').notNull().references(() => draftVersions.id),
  socialAccountId: uuid('social_account_id').notNull().references(() => socialAccounts.id),
  contentHash: text('content_hash').notNull(),
  approvedBy: uuid('approved_by').notNull().references(() => users.id),
  invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
  invalidatedReason: text('invalidated_reason'),
  createdAt: createdAt(),
});

/* ─────────────── Publicación ─────────────── */

export const publications = pgTable(
  'publications',
  {
    id: id(),
    orgId: orgId(),
    draftId: uuid('draft_id').notNull().references(() => drafts.id, { onDelete: 'cascade' }),
    approvalId: uuid('approval_id').notNull().references(() => approvals.id),
    draftVersionId: uuid('draft_version_id').notNull().references(() => draftVersions.id),
    socialAccountId: uuid('social_account_id').notNull().references(() => socialAccounts.id),
    /** queued | scheduled | publishing | published | failed | unconfirmed | cancelled */
    status: text('status').notNull(),
    /** Instante UTC inequívoco */
    runAt: timestamp('run_at', { withTimezone: true }).notNull(),
    /** Zona horaria de la marca con la que se eligió la hora */
    scheduledTimezone: text('scheduled_timezone'),
    idempotencyKey: text('idempotency_key').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    externalId: text('external_id'),
    externalUrl: text('external_url'),
    lastError: text('last_error'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('publications_approval_unique').on(t.approvalId),
    uniqueIndex('publications_idempotency_unique').on(t.idempotencyKey),
    index('publications_due_idx').on(t.status, t.runAt),
  ],
);

export const publicationAttempts = pgTable('publication_attempts', {
  id: id(),
  publicationId: uuid('publication_id').notNull().references(() => publications.id, { onDelete: 'cascade' }),
  attempt: integer('attempt').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  /** pending | success | failed | ambiguous | verified_published | verified_absent */
  outcome: text('outcome').notNull().default('pending'),
  providerResponse: jsonb('provider_response').$type<Record<string, unknown>>(),
});

/** Almacén del publicador simulado: permite comprobar resultados tras un timeout. */
export const simulatedPosts = pgTable('simulated_posts', {
  id: id(),
  platform: text('platform').notNull(),
  handle: text('handle').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  text: text('text').notNull(),
  createdAt: createdAt(),
});

/* ─────────────── Entrega móvil ─────────────── */

export const notificationRecipients = pgTable(
  'notification_recipients',
  {
    id: id(),
    orgId: orgId(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(), // telegram
    /** chat_id de Telegram una vez vinculado */
    address: text('address'),
    linkCode: text('link_code'),
    linkCodeExpiresAt: timestamp('link_code_expires_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    enabled: boolean('enabled').notNull().default(true),
    /** Horario silencioso en la zona horaria indicada, "HH:MM" */
    quietStart: text('quiet_start'),
    quietEnd: text('quiet_end'),
    timezone: text('timezone').notNull().default('America/Lima'),
    dailyLimit: integer('daily_limit').notNull().default(10),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('recipients_user_channel').on(t.orgId, t.userId, t.channel),
    uniqueIndex('recipients_link_code').on(t.linkCode),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    orgId: orgId(),
    recipientId: uuid('recipient_id').notNull().references(() => notificationRecipients.id, { onDelete: 'cascade' }),
    draftId: uuid('draft_id').references(() => drafts.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // draft_ready | published | publish_failed | publish_unconfirmed
    /** accepted = el proveedor lo aceptó (no implica lectura) */
    status: text('status').notNull(), // accepted | failed | suppressed
    dedupeKey: text('dedupe_key').notNull(),
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('notifications_dedupe').on(t.dedupeKey)],
);

/* ─────────────── Operación ─────────────── */

/** Cola duradera genérica (outbox). */
export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    kind: text('kind').notNull(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** pending | running | done | failed */
    status: text('status').notNull().default('pending'),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('jobs_due_idx').on(t.status, t.runAt),
    uniqueIndex('jobs_dedupe').on(t.dedupeKey),
  ],
);

export const feedback = pgTable('feedback', {
  id: id(),
  orgId: orgId(),
  brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'cascade' }),
  recommendationId: uuid('recommendation_id').references(() => recommendations.id, { onDelete: 'cascade' }),
  draftId: uuid('draft_id').references(() => drafts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id),
  useful: boolean('useful').notNull(),
  reason: text('reason'),
  createdAt: createdAt(),
});

export const usageEvents = pgTable(
  'usage_events',
  {
    id: id(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // generation | source_query | notification | publication
    units: integer('units').notNull().default(1),
    costUsd: numeric('cost_usd', { mode: 'number' }).notNull().default(0),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('usage_org_day_idx').on(t.orgId, t.createdAt)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('audit_org_idx').on(t.orgId, t.createdAt)],
);

/** Estado interno del sistema (p. ej. offset de getUpdates de Telegram). */
export const systemState = pgTable('system_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});
