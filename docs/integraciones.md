# Integraciones

| Integración | Estado | Cómo se identifica en la app |
| --- | --- | --- |
| Telegram (avisos al teléfono) | **REAL** si hay `TELEGRAM_BOT_TOKEN`; si no, SIMULADA en la consola del worker | Aviso amarillo en "Teléfono"; etiqueta "Simulado" |
| Publicación en X | **SIMULADA** (fase 4) | Etiqueta "Publicación simulada"; botón "Aprobar y publicar (simulado)"; enlace `sim-…` |
| Generación de contenido | **SIMULADA** (fase 3) | "generado con plantilla (IA simulada)" |
| Fuentes RSS, Hacker News, GitHub | **PENDIENTE** (fase 2) | Acontecimientos con etiqueta DEMO |
| Fuentes X, Reddit | **PENDIENTE**: requieren verificar acceso y costes | — |

La pantalla **Estado** muestra esta tabla en vivo.

## Telegram: recibir avisos en el iPhone

### 1. Crear el bot (una vez)

1. Instala Telegram en el iPhone.
2. Abre **@BotFather** → `/newbot` → elige nombre y usuario (debe terminar en `bot`).
3. Copia el token que te da. Es un secreto: no lo compartas ni lo subas al repositorio.
4. Pégalo en `.env`: `TELEGRAM_BOT_TOKEN=123456:ABC...`
5. Reinicia `pnpm dev`. En la consola del worker debe decir `Notificaciones (Telegram): REAL`.

### 2. Que el iPhone pueda abrir la propuesta

El botón del aviso abre `PUBLIC_BASE_URL/m/drafts/<id>`. Opciones:

- **Misma Wi-Fi (desarrollo):** `PUBLIC_BASE_URL=http://<IP-de-tu-PC>:3100`. Para ver la IP en Windows: `ipconfig` → "Dirección IPv4".
  Si el iPhone no carga la página, el Firewall de Windows puede estar bloqueando el puerto 3100: permite Node.js en redes privadas cuando Windows lo pregunte (o desde "Firewall de Windows Defender → Permitir una aplicación").
  Telegram no acepta botones con direcciones locales; en ese caso el enlace llega dentro del texto del mensaje.
- **Fuera de casa:** una URL https (túnel como Cloudflare Tunnel o el despliegue). Con https el aviso muestra un botón y la cookie de sesión se marca `Secure`.

### 3. Vincular el teléfono

1. Crea tu cuenta en la web (también puedes hacerlo desde el iPhone).
2. **Teléfono → Conectar Telegram**.
3. Abre el enlace **en el iPhone** y pulsa **Iniciar** (o envía `/start <código>` al bot).
4. El bot responde "✅ Listo" y la página muestra "Vinculado".
5. Inicia sesión en Radar desde Safari en el iPhone una vez: la sesión dura 30 días.

### Qué recibe el teléfono

- "Radar · Nueva propuesta lista para {marca}" + botón **Revisar propuesta**.
- "✅ Publicado en X (@cuenta)" + enlace (o "Publicación SIMULADA…" en esta fase).
- "⚠️ No se pudo publicar…" o "❓ No sabemos si se publicó…" + botón para resolver.

El texto del post no aparece en la notificación (pantalla bloqueada).

## X (fase 4)

Antes de implementar:

1. Verificar en la documentación oficial de X el plan vigente de la API, el coste por publicación y los límites.
2. Crear una app en el portal de desarrolladores de X con permisos de lectura y escritura (OAuth 2.0 con PKCE, alcance `tweet.write`).
3. El token se guarda cifrado en el servidor; `social_accounts.credentials_ref` apunta a él.
4. El propietario activa `live_enabled` para esa cuenta de forma explícita.

Hasta entonces, `publications` se procesa con `SimulatedXPublisher` y los posts quedan en la tabla `simulated_posts`.

## Claude (fase 3)

1. Crear una API key en la consola de Anthropic y definir un límite de gasto.
2. `CONTENT_GENERATOR=claude` y `ANTHROPIC_API_KEY=...` en `.env`.
3. El adaptador registrará el coste real en `usage_events`; `DAILY_BUDGET_USD` detiene la generación antes de excederse.

## Fuentes (fase 2)

Cada conector implementará el contrato de la sección 8 (capacidades, cursor incremental, límites, "sin resultados" ≠ "fallo de acceso"). Orden previsto: RSS → Hacker News (API pública de Firebase) → GitHub (API REST, token opcional para más cuota). Las URLs de RSS se validarán contra direcciones internas (SSRF) antes de consultarlas.
