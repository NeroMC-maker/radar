import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Carga el .env de la raíz del repositorio (scripts de línea de comandos y worker).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
config({ path: path.join(root, '.env'), quiet: true });
