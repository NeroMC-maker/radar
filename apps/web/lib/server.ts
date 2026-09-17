import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  AppError,
  brandsModule,
  createIntegrations,
  getDb,
  identity,
  loadConfig,
  type Actor,
  type Services,
} from '@radar/core';

export const SESSION_COOKIE = 'radar_session';
export const ORG_COOKIE = 'radar_org';
export const BRAND_COOKIE = 'radar_brand';

const g = globalThis as unknown as { __radarServices?: Services };

export function services(): Services {
  if (!g.__radarServices) {
    const config = loadConfig();
    const db = getDb();
    g.__radarServices = { db, config, ...createIntegrations(db, config) };
  }
  return g.__radarServices;
}

export function secureCookies() {
  return services().config.PUBLIC_BASE_URL.startsWith('https://');
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    path: '/',
    expires: expiresAt,
  });
}

/** Solo rutas internas: evita redirecciones abiertas. */
export function safeNext(next: string | null | undefined, fallback = '/radar') {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}

export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return identity.userFromSession(services().db, token);
}

export type PageContext = {
  user: { id: string; name: string; email: string };
  actor: Actor;
  orgs: { orgId: string; orgName: string; roles: string[] }[];
  orgName: string;
};

/**
 * Exige sesión y resuelve la organización activa verificando la membresía en el servidor.
 * `next` es la ruta a la que volver tras iniciar sesión (p. ej. el enlace de la notificación).
 */
export async function requireContext(next: string): Promise<PageContext> {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  const orgs = await identity.listMemberships(services().db, user.id);
  if (orgs.length === 0) redirect('/register');
  const jar = await cookies();
  const wanted = jar.get(ORG_COOKIE)?.value;
  const org = orgs.find((o) => o.orgId === wanted) ?? orgs[0]!;
  const actor = await identity.resolveActor(services().db, user.id, org.orgId);
  return { user, actor, orgs, orgName: org.orgName };
}

/** Contexto para una propuesta concreta: cambia a la organización dueña si el usuario pertenece a ella. */
export async function requireContextForOrg(next: string, orgId: string | null): Promise<PageContext> {
  const ctx = await requireContext(next);
  if (orgId && orgId !== ctx.actor.orgId && ctx.orgs.some((o) => o.orgId === orgId)) {
    const actor = await identity.resolveActor(services().db, ctx.user.id, orgId);
    return { ...ctx, actor, orgName: ctx.orgs.find((o) => o.orgId === orgId)!.orgName };
  }
  return ctx;
}

export async function activeBrand(actor: Actor, requested?: string | null) {
  const list = await brandsModule.listBrands(services().db, actor);
  const jar = await cookies();
  const wanted = requested ?? jar.get(BRAND_COOKIE)?.value;
  return { brands: list, brand: list.find((b) => b.id === wanted) ?? list[0] ?? null };
}

/** Mensaje apto para mostrar: solo errores de negocio; el resto se registra y se oculta. */
export function userMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e && typeof e === 'object' && 'issues' in e && Array.isArray((e as { issues: unknown[] }).issues)) {
    const first = (e as { issues: { message: string }[] }).issues[0];
    return first?.message ?? 'Datos inválidos';
  }
  console.error(e);
  return 'Algo salió mal. Inténtalo de nuevo.';
}

/** Redirecciona con un mensaje en la URL (se muestra con <Flash/>). */
export function withMessage(path: string, kind: 'error' | 'ok', message: string): string {
  const url = new URL(path, 'http://x');
  url.searchParams.set(kind, message);
  return url.pathname + url.search;
}
