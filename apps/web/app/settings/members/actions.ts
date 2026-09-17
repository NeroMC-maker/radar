'use server';

import { redirect } from 'next/navigation';
import { ROLES, identity, type Role } from '@radar/core';
import { requireContext, services, userMessage, withMessage } from '@/lib/server';

export async function updateRolesAction(fd: FormData) {
  const ctx = await requireContext('/settings/members');
  const roles = fd.getAll('roles').filter((r): r is Role => typeof r === 'string' && (ROLES as readonly string[]).includes(r));
  let target: string;
  try {
    await identity.updateMemberRoles(services().db, ctx.actor, String(fd.get('userId') ?? ''), roles);
    target = withMessage('/settings/members', 'ok', 'Roles actualizados.');
  } catch (e) {
    target = withMessage('/settings/members', 'error', userMessage(e));
  }
  redirect(target);
}
