import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function Home() {
  redirect((await currentUser()) ? '/radar' : '/login');
}
