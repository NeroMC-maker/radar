# Radar

SaaS para Community Managers, freelancers y agencias que responde **¿qué debería publicar hoy mi marca y por qué?**
Detecta acontecimientos, prepara contenido con la voz de la marca, avisa al teléfono y permite aprobar y publicar la versión exacta.

> **Estado: Fase 1 (recorrido móvil completo).** Las fuentes son de demostración, la generación y la publicación en X están simuladas.
> Telegram es real en cuanto se configura el token. Ver [docs/limitaciones.md](docs/limitaciones.md).

## Requisitos

- Node.js 22 o superior (probado con 24)
- pnpm 10 o superior
- Nada más: en desarrollo la base de datos es un Postgres embebido (sin Docker).

## Puesta en marcha

```bash
pnpm install
cp .env.example .env        # en Windows: copy .env.example .env
pnpm dev                    # Postgres + web (puerto 3100) + worker
pnpm seed                   # en otra terminal, la primera vez: datos de demostración
```

Abre http://localhost:3100, crea tu cuenta y configura una marca.

### Recibir los avisos en el iPhone

1. En Telegram, habla con **@BotFather** → `/newbot` → copia el token.
2. Pégalo en `.env` como `TELEGRAM_BOT_TOKEN=...`.
3. En `.env`, pon `PUBLIC_BASE_URL=http://<IP-de-tu-PC>:3100` (el iPhone debe estar en la misma Wi-Fi).
4. Reinicia `pnpm dev`.
5. En la web: **Teléfono → Conectar Telegram** y abre el enlace en el iPhone.

Detalles y alternativas (túnel https, despliegue) en [docs/integraciones.md](docs/integraciones.md).

## Comandos

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` | Base de datos, web y worker en paralelo |
| `pnpm seed` | Carga o refresca los acontecimientos de demostración |
| `pnpm test` | Pruebas unitarias y de integración (Postgres embebido temporal) |
| `pnpm typecheck` | Verificación de tipos de todo el monorepo |
| `pnpm db:generate` | Genera una migración tras cambiar `schema.ts` |
| `pnpm db:migrate` | Aplica migraciones (el worker también lo hace al arrancar) |

## Estructura

```
apps/web        Next.js: interfaz de escritorio y móvil + acciones de servidor
apps/worker     Procesos en segundo plano: publicación, avisos, Telegram, recálculo
packages/core   Dominio, reglas, persistencia, integraciones (única fuente de reglas)
  src/domain        estados, roles, motor de tendencias, zonas horarias
  src/modules       casos de uso por dominio (identidad, marcas, radar, borradores…)
  src/integrations  Telegram, publicador de X, generador de contenido
  src/db            esquema Drizzle; migraciones en packages/core/drizzle
  test              pruebas de recorridos críticos
docs/           especificación, arquitectura, decisiones, operación, limitaciones
scripts/        Postgres embebido de desarrollo
```

## Documentación

- [Especificación del producto](docs/especificacion.md)
- [Arquitectura](docs/arquitectura.md)
- [Decisiones técnicas](docs/decisiones.md)
- [Integraciones: reales, simuladas y cómo activarlas](docs/integraciones.md)
- [Operación, despliegue y recuperación](docs/operacion.md)
- [Limitaciones y pendientes](docs/limitaciones.md)
