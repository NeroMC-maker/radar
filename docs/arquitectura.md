# Arquitectura

## Vista general

```
 iPhone (Telegram) ──aviso──┐                         ┌── Telegram Bot API (real)
        │ toca "Revisar"    │                         │
        ▼                   │                         │
 ┌──────────────┐     ┌─────┴────────┐          ┌─────┴─────────┐
 │  apps/web    │     │ apps/worker  │          │ Integraciones │
 │  Next.js     │     │ bucles:      │─────────▶│ Notifier      │
 │  pantallas + │     │ publicación  │          │ Publisher (X) │
 │  acciones de │     │ trabajos     │          │ Generator     │
 │  servidor    │     │ telegram     │          └───────────────┘
 └──────┬───────┘     │ mantenimiento│
        │             └──────┬───────┘
        │   packages/core (reglas, casos de uso, esquema)
        ▼                    ▼
 ┌───────────────────────────────────────────────┐
 │ Postgres: estado + cola (jobs) + envíos       │
 │ (publications) + auditoría + consumo          │
 └───────────────────────────────────────────────┘
```

## Correspondencia con la especificación

| Componente (sección 4) | Implementación | Estado |
| --- | --- | --- |
| Aplicación web adaptable | `apps/web` | Listo |
| Backend | acciones de servidor + `packages/core/src/modules` | Listo |
| Trabajadores | `apps/worker` | Listo |
| Cola duradera | tabla `jobs` (outbox, `SKIP LOCKED`, reintentos) | Listo |
| Programador | `publications.run_at` + bucle de mantenimiento | Listo |
| Base relacional | Postgres + Drizzle | Listo |
| Búsqueda semántica | pgvector | Fase 2 |
| Almacenamiento de archivos | — | Fase 3 (documentos de marca) |
| Notificaciones | `Notifier` → Telegram / consola | Listo (Telegram real con token) |
| Gestor de secretos | `.env` en el servidor; `social_accounts.credentials_ref` | Fase 4–5 |
| Observabilidad | `usage_events`, `audit_log`, pantalla Estado | Básico |

## Dominios (sección 5) → módulos

| Dominio | Archivo |
| --- | --- |
| Identidad y organizaciones | `modules/identity.ts`, `domain/roles.ts` |
| Marcas y voz | `modules/brands.ts` |
| Fuentes y referentes | `db/schema.ts` (`sources`, `collection_runs`, `brands.referents`) — conectores en fase 2 |
| Acontecimientos y evidencias | `db/schema.ts` (`events`, `event_signals`, `evidence_versions`, `event_corrections`) |
| Tendencias y recomendaciones | `domain/trend.ts`, `modules/radar.ts` |
| Generación y edición | `integrations/generator`, `modules/drafts.ts` |
| Aprobaciones | `modules/approvals.ts`, `domain/draft-states.ts`, `domain/content-hash.ts` |
| Notificaciones | `modules/notifications.ts`, `integrations/notifier` |
| Programación y publicación | `modules/publications.ts`, `integrations/publisher` |
| Feedback y analítica | `modules/radar.ts` (`recordFeedback`, `dismissRecommendation`) |
| Consumo, auditoría y operación | `modules/audit.ts`, `modules/jobs.ts`, `modules/runner.ts` |

## Separación de datos

- **Compartido** (sin `org_id` o `org_id` nulo): `events`, `signals` públicas, `signal_measurements`, `evidence_versions`, `trend_evaluations`.
- **Privado** (con `org_id`): marcas, voz, ejemplos, recomendaciones, borradores y versiones, cuentas sociales, aprobaciones, publicaciones, destinatarios y notificaciones, feedback, consumo, auditoría.
- Toda función privada recibe un `Actor` (`userId`, `orgId`, `roles`) resuelto en el servidor desde la membresía, y filtra por `org_id`. Un recurso ajeno responde "no encontrado".

## Recorrido principal

1. `createDraftFromEvent` genera el texto, guarda versión 1 con huella, voz y evidencia, y encola `notify_draft_ready` **en la misma transacción**.
2. El worker entrega el aviso a cada aprobador vinculado (una vez por destinatario; respeta silencio y límite diario).
3. El iPhone abre `/m/drafts/:id`. Sin sesión → login → vuelve a la propuesta.
4. `approveAndPublish` bloquea el borrador, verifica rol, versión, cuenta y huella, e inserta aprobación + publicación en una transacción.
5. El worker toma la publicación, revalida aprobación y huella, marca `publishing`, registra el intento y llama al publicador.
6. Resultado → `published` / reintento / `failed` / `unconfirmed`, y encola el aviso de resultado para quien aprobó.

## Estados editoriales

```
draft ─▶ in_review ─▶ (aprobar) ─▶ queued ─▶ publishing ─▶ published
                          │                      │
                          └▶ scheduled ──(vence)─┘      ├─▶ failed ─▶ (reintentar)
                                                         └─▶ unconfirmed ─▶ (resolver)
editar con aprobación pendiente ─▶ needs_review
rechazar ─▶ rejected        descartar ─▶ cancelled
```
