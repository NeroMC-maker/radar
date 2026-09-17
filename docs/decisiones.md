# Decisiones técnicas

Registro de decisiones (más reciente al final). Cada una indica contexto, decisión y motivo.

## D1 · Stack: TypeScript en un monorepo pnpm (2026-09-16)

- **Decisión:** `apps/web` (Next.js 16, App Router), `apps/worker` (Node + tsx), `packages/core` (dominio, persistencia, integraciones).
- **Motivo:** un solo lenguaje; las reglas de aprobación, estados y permisos viven en `core` y se reutilizan en web y worker sin duplicarse (sección 19). Next.js resuelve interfaz adaptable y backend (acciones de servidor con protección de origen) sin un servicio extra.
- **Descartado:** backend separado (Nest/Fastify) y microservicios: el MVP no lo necesita.

## D2 · Postgres + Drizzle; Postgres embebido en desarrollo (2026-09-16)

- **Decisión:** Postgres como base relacional, Drizzle ORM con migraciones SQL versionadas. En desarrollo, `embedded-postgres` (binarios de Postgres 17 dentro de `node_modules`).
- **Motivo:** la PC del propietario no tiene Docker ni Postgres. Transacciones y `FOR UPDATE SKIP LOCKED` son la base de la idempotencia y de la cola.
- **Nota Windows:** el clúster se inicializa con `--encoding=UTF8 --locale=C`; por defecto heredaba WIN1252 y rechazaba emojis.
- **Pendiente:** búsqueda semántica (pgvector) en la fase 2, con un Postgres gestionado que lo incluya.

## D3 · Cola duradera y programador sobre la misma base de datos (2026-09-16)

- **Decisión:** tabla `jobs` (outbox) y tabla `publications` como cola de envíos, consumidas por el worker con `SKIP LOCKED`. Las publicaciones programadas son filas con `run_at` UTC.
- **Motivo:** la aprobación y la solicitud de envío se escriben en **la misma transacción** (sección 14). Una cola externa (Redis, pg-boss) obligaría a coordinar dos sistemas. Las programadas sobreviven a reinicios porque son datos, no temporizadores.
- **Revisar si:** el volumen supera cientos de trabajos por segundo.

## D4 · Notificaciones: bot de Telegram con long polling (2026-09-16)

- **Decisión del propietario:** Telegram. Teléfono: iPhone.
- **Validación (sección 13):** Telegram entrega con la app cerrada en iOS y Android mediante sus propias notificaciones push; no requiere instalar una PWA (el push web en iOS exige añadir la web a la pantalla de inicio); la Bot API es gratuita; el destinatario se asocia con un código de un solo uso (`/start <código>`) que caduca en 30 minutos.
- **Long polling (`getUpdates`)** en lugar de webhook: no hace falta exponer la PC a internet para vincular teléfonos.
- **Interfaz intercambiable:** `Notifier` (`packages/core/src/integrations/notifier/types.ts`). Sin token se usa `ConsoleNotifier` (simulado).
- **Privacidad:** el aviso no incluye el texto del post, solo "Nueva propuesta lista para {marca}".
- **Botón con URL local:** Telegram rechaza botones con URLs privadas; en ese caso el aviso se reenvía con el enlace dentro del texto.

## D5 · Primera red de publicación: X, simulada en esta fase (2026-09-16)

- **Decisión del propietario:** X.
- **Estado:** `SimulatedXPublisher` guarda los posts en `simulated_posts` e implementa `lookup` para probar resultados ambiguos.
- **Pendiente (fase 4):** verificar el plan vigente de la API de X, sus costes y límites antes de implementar el publicador real (OAuth 2.0 con permiso de escritura). Hasta entonces las cuentas son `mode = simulated` y el envío real exige `live_enabled = true`, que solo activa el propietario.

## D6 · Generación de contenido simulada (2026-09-16)

- **Decisión del propietario:** simulada hasta que haya API key.
- **Estado:** `SimulatedGenerator` arma el texto con plantillas a partir de la ficha de evidencia y la voz; marca sus propuestas como "IA simulada"; no atribuye opiniones si la marca no tiene posicionamiento.
- **Fase 3:** adaptador de Claude detrás de `ContentGenerator`, con coste registrado en `usage_events` y comprobación de presupuesto previa.

## D7 · Aprobación de una versión exacta con huella de contenido (2026-09-16)

- `content_hash` = SHA-256 de texto + recursos + cuenta de destino. La aprobación guarda la huella; el worker la vuelve a comprobar antes de enviar.
- Editar crea una versión nueva; si había una aprobación pendiente de envío, se invalida y el envío se cancela en la misma transacción (estado `needs_review`).
- Aprobar exige el `versionId` que la persona tenía en pantalla; si cambió, responde conflicto.
- Idempotencia: la clave de publicación es `pub:<approval_id>` (única). Dos pulsaciones simultáneas se serializan con `FOR UPDATE` sobre el borrador y la segunda devuelve la misma publicación.

## D8 · Envíos ambiguos (2026-09-16)

- Timeout o excepción del proveedor → `lookup` por clave de idempotencia:
  - encontrado → publicado (`verified_published`);
  - no encontrado → reintento con espera progresiva (`verified_absent`);
  - no comprobable → `unconfirmed`, sin reintento automático; el aprobador decide desde el móvil.
- Una publicación que quedó en `publishing` más de 5 minutos (proceso caído) sigue el mismo camino al arrancar el worker.

## D9 · Bloqueos sin interbloqueo entre edición y worker (2026-09-16)

- La web bloquea primero el borrador y luego las publicaciones. El worker bloquea la publicación y luego intenta el borrador con `SKIP LOCKED`: si alguien está editando, lo deja para la siguiente vuelta.

## D10 · Motor de tendencias v1 determinista (2026-09-16)

- Funciones puras en `domain/trend.ts` con los pesos de la sección 10 (`TREND_WEIGHTS_V1`, versionados).
- Crecimiento suavizado con un prior (evita "+200 %" con bases de 1 a 3).
- Factores sin datos → `null`: no suman, su peso se redistribuye y baja la confianza.
- Salud de recolección < 0.7 → dirección `unknown` (no "perdiendo fuerza").
- Afinidad es un índice 0–100 y así se muestra; las exclusiones se aplican antes de puntuar y eliminan la recomendación.

## D11 · Sesiones propias (2026-09-16)

- Contraseñas con scrypt; sesiones en tabla con hash SHA-256 del token; cookie `HttpOnly`, `SameSite=Lax`, `Secure` cuando la URL pública es https.
- Enlaces de notificación: abrir el enlace sin sesión lleva a iniciar sesión y vuelve a la propuesta (`next` validado como ruta interna).
- **Descartado por ahora:** proveedor externo de identidad (costo y dependencia). Revisar en la fase 5 (recuperación de contraseña, invitaciones).

## D13 · Voz deducida con ejercicios de escritura (2026-09-16)

- **Pedido del propietario:** que la persona escriba para que el sistema aprenda cómo redacta.
- **Decisión:** pantalla `/brand/voice` con 3 consignas (anunciar una novedad, comentar una tendencia, responder a un cliente) y la opción de pegar posts reales. Aparece como paso 2 al crear una marca.
- `domain/voice-inference.ts` deduce, **por reglas y sin IA**: tono, trato (tú o usted), emojis, longitud, nivel técnico, exclamaciones, aperturas, cierres, expresiones repetidas, hashtags y tipo de llamada a la acción. Cada rasgo va con la evidencia que lo justifica y hay un índice de confianza.
- Cumple la sección 7: los rasgos deducidos se **muestran para validar**. Nada se guarda hasta que la persona confirma. Al confirmar se crea una versión nueva de voz y los textos quedan como ejemplos aprobados.
- Aperturas, cierres y expresiones se editan **una por línea**, porque pueden llevar comas ("¡Hola, comunidad!").
- **Fase 3:** con Claude se podrá afinar la deducción y usar los ejemplos para imitar el estilo; las reglas quedan como respaldo sin coste.

## D12 · Puerto 3100 en desarrollo (2026-09-16)

- El puerto 3000 lo usa otro proyecto del propietario (Neurolee). Radar usa 3100.
