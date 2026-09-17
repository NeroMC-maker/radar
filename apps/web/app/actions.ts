'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { identity } from '@radar/core';
import {
  BRAND_COOKIE,
  ORG_COOKIE,
  SESSION_COOKIE,
  currentUser,
  safeNext,
  secureCookies,
  services,
  setSessionCookie,
  userMessage,
  withMessage,
} from '@/lib/server';

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : '';
};

export async function loginAction(fd: FormData) {
  const next = safeNext(str(fd, 'next'));
  let target: string;
  try {
    const { token, expiresAt } = await identity.login(services().db, str(fd, 'email'), str(fd, 'password'));
    await setSessionCookie(token, expiresAt);
    target = next;
  } catch (e) {
    target = withMessage(`/login?next=${encodeURIComponent(next)}`, 'error', userMessage(e));
  }
  redirect(target);
}

export async function registerAction(fd: FormData) {
  let target: string;
  try {
    const { user } = await identity.register(services().db, {
      name: str(fd, 'name'),
      email: str(fd, 'email'),
      password: str(fd, 'password'),
      orgName: str(fd, 'orgName'),
    });
    const { token, expiresAt } = await identity.createSession(services().db, user.id);
    await setSessionCookie(token, expiresAt);
    target = '/onboarding';
  } catch (e) {
    target = withMessage('/register', 'error', userMessage(e));
  }
  redirect(target);
}

export async function logoutAction() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await identity.logout(services().db, token);
  jar.delete(SESSION_COOKIE);
  redirect('/login');
}

export async function switchOrgAction(fd: FormData) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const orgId = str(fd, 'orgId');
  // Solo se acepta una organización a la que el usuario pertenece.
  await identity.resolveActor(services().db, user.id, orgId);
  const jar = await cookies();
  jar.set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: 'lax', secure: secureCookies(), path: '/' });
  jar.delete(BRAND_COOKIE);
  redirect('/radar');
}

export async function selectBrandAction(fd: FormData) {
  const jar = await cookies();
  jar.set(BRAND_COOKIE, str(fd, 'brandId'), { httpOnly: true, sameSite: 'lax', secure: secureCookies(), path: '/' });
  redirect('/radar');
}
