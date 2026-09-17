# Operación, despliegue y recuperación

## Procesos

| Proceso | Comando | Notas |
| --- | --- | --- |
| Web | `pnpm --filter @radar/web start` (tras `build`) | Puerto 3100, escucha en 0.0.0.0 |
| Worker | `pnpm --filter @radar/worker start` | Aplica migraciones al arrancar. Puede haber varios. |
| Base de datos | Postgres gestionado (`DATABASE_URL`) | En desarrollo: `pnpm db` |

El worker ejecuta cuatro bucles: publicaciones (cada 2 s), trabajos (cada 1 s), Telegram (long polling) y mantenimiento (cada 5 min: recuperación y recálculo de recomendaciones).

## Despliegue (propuesta para el piloto)

1. Postgres gestionado con copias automáticas (Neon, Supabase o equivalente) → `DATABASE_URL`.
2. Web y worker en un servicio de contenedores o PaaS con Node 22+. El worker es un proceso sin puerto.
3. `PUBLIC_BASE_URL` con https (dominio propio).
4. Variables de entorno en el gestor de secretos del proveedor, nunca en el repositorio.
5. `pnpm install --frozen-lockfile && pnpm --filter @radar/web build`.

## Recuperación ante reinicios

- **Trabajos** que quedaron `running` más de 5 min vuelven a `pending`.
- **Publicaciones** que quedaron `publishing` más de 5 min se **comprueban** con el proveedor antes de hacer nada:
  publicado → se marca publicado; no publicado → se reencola; no comprobable → `unconfirmed` y aviso al aprobador.
- **Programadas** son filas con `run_at` UTC: se envían cuando vence, aunque el sistema haya estado apagado (con retraso).

## Envíos inciertos

Pantalla móvil de la propuesta → "Sí se publicó" (con enlace opcional) o "No se publicó: reintentar".
El reintento usa la misma clave de idempotencia.

## Copias de seguridad

- Producción: copias automáticas del proveedor + `pg_dump` diario a almacenamiento externo.
- Prueba de restauración mensual: restaurar el dump en una base nueva, apuntar un worker de prueba y comprobar que `pnpm test` y la pantalla Estado funcionan.
- Desarrollo: los datos están en `.data/pg` (ignorado por git). Borrar esa carpeta reinicia la base.

```bash
pg_dump "$DATABASE_URL" --format=custom --file=radar-$(date +%F).dump
```

```bash
pg_restore --clean --if-exists --dbname="$RESTORE_URL" radar-2026-09-16.dump
```

## Monitorización

Pantalla **Estado** (propietario): integraciones reales/simuladas, cola de trabajos, publicaciones fallidas e inciertas, tiempo medio hasta publicar, consumo y presupuesto, auditoría reciente.

## Problemas conocidos en Windows

- `character with byte sequence … has no equivalent in encoding "WIN1252"`: la base de desarrollo se creó sin UTF-8. Detén `pnpm dev`, borra `.data/pg` y vuelve a arrancar.
- Puerto 3000 ocupado por otro proyecto: Radar usa 3100.
