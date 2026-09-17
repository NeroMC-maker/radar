import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';

// Un único .env en la raíz del repositorio para web y worker.
loadEnv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

const publicHost = (() => {
  try {
    return new URL(process.env.PUBLIC_BASE_URL ?? '').hostname;
  } catch {
    return undefined;
  }
})();

const nextConfig: NextConfig = {
  transpilePackages: ['@radar/core'],
  serverExternalPackages: ['pg'],
  // Permite abrir el servidor de desarrollo desde el teléfono (IP de la red local o túnel).
  allowedDevOrigins: publicHost && publicHost !== 'localhost' ? [publicHost] : [],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
