import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { memberships, organizations, sessions, users } from '../db/schema';
import { can, type Capability, type Role } from '../domain/roles';
import { AppError, forbidden, invalid } from '../errors';
import { audit } from './audit';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** Quién actúa y en qué organización. Toda operación privada recibe uno. */
export type Actor = { userId: string; orgId: string; roles: Role[] };

export const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(key, expected);
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Escribe tu nombre').max(100),
  email: z.string().trim().toLowerCase().email('Correo inválido'),
  password: z.string().min(10, 'La contraseña necesita al menos 10 caracteres').max(200),
  orgName: z.string().trim().min(1, 'Escribe el nombre de tu organización').max(100),
});

/** Crea usuario + organización. El creador recibe los tres roles: un freelancer completa todo el flujo solo. */
export async function register(db: Db, raw: z.input<typeof registerSchema>) {
  const input = registerSchema.parse(raw);
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (existing) throw new AppError('conflict', 'Ya existe una cuenta con ese correo');
    const [user] = await tx
      .insert(users)
      .values({ email: input.email, name: input.name, passwordHash })
      .returning();
    const [org] = await tx.insert(organizations).values({ name: input.orgName }).returning();
    await tx.insert(memberships).values({ orgId: org!.id, userId: user!.id, roles: ['owner', 'editor', 'approver'] });
    await audit(tx, { orgId: org!.id, userId: user!.id, action: 'org.created', entity: 'organization', entityId: org!.id });
    return { user: user!, org: org! };
  });
}

export async function login(db: Db, email: string, password: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  // Se verifica igualmente para no revelar si el correo existe por el tiempo de respuesta.
  const ok = await verifyPassword(password, user?.passwordHash ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(88));
  if (!user || !ok) throw invalid('Correo o contraseña incorrectos');
  return createSession(db, user.id);
}

export async function createSession(db: Db, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function logout(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function userFromSession(db: Db, token: string | undefined) {
  if (!token) return null;
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
  return row ?? null;
}

export async function listMemberships(db: Db, userId: string) {
  return db
    .select({ orgId: organizations.id, orgName: organizations.name, roles: memberships.roles })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, userId))
    .orderBy(organizations.createdAt);
}

/** Resuelve el actor verificando la membresía en el servidor. */
export async function resolveActor(db: Db, userId: string, orgId: string): Promise<Actor> {
  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)));
  if (!m) throw forbidden('No perteneces a esta organización');
  return { userId, orgId, roles: m.roles as Role[] };
}

export function requireCap(actor: Actor, capability: Capability) {
  if (!can(actor.roles, capability)) throw forbidden();
}

export async function updateMemberRoles(db: Db, actor: Actor, userId: string, roles: Role[]) {
  requireCap(actor, 'members.manage');
  await db.transaction(async (tx) => {
    const owners = await tx.select().from(memberships).where(eq(memberships.orgId, actor.orgId));
    const remainingOwners = owners.filter((m) => (m.userId === userId ? roles.includes('owner') : m.roles.includes('owner')));
    if (remainingOwners.length === 0) throw invalid('La organización necesita al menos un propietario');
    await tx
      .update(memberships)
      .set({ roles })
      .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, userId)));
    await audit(tx, { orgId: actor.orgId, userId: actor.userId, action: 'member.roles_changed', entity: 'user', entityId: userId, data: { roles } });
  });
}

export async function listMembers(db: Db, actor: Actor) {
  requireCap(actor, 'brand.read');
  return db
    .select({ userId: users.id, name: users.name, email: users.email, roles: memberships.roles })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, actor.orgId));
}
