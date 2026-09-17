/** Solo desarrollo: crea (si no existe) un usuario de prueba y emite un token de sesión. */
import '../load-env';
import { randomBytes } from 'node:crypto';
import { createDb } from '../db/client';
import * as identity from '../modules/identity';

const email = process.argv[2] ?? 'demo@radar.local';
const { db, pool } = createDb(process.env.DATABASE_URL!);
let [user] = await db.query.users.findMany({ where: (u, { eq }) => eq(u.email, email) });
if (!user) {
  ({ user } = await identity.register(db, {
    name: 'Usuario demo',
    email,
    password: randomBytes(24).toString('base64url'),
    orgName: 'Agencia demo',
  }));
}
const { token } = await identity.createSession(db, user.id);
console.log(token);
await pool.end();
