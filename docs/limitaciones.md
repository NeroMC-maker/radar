# Limitaciones y pendientes

Estado al cierre de la **Fase 1** (2026-09-16).

## Requisitos externos pendientes del propietario

| Qué | Para qué | Coste |
| --- | --- | --- |
| Token de bot de Telegram (@BotFather) | Avisos reales al iPhone | Gratis |
| URL accesible desde el iPhone (IP local o https) | Abrir la propuesta desde el aviso | Gratis (red local) |
| Acceso a la API de X + autorización de la cuenta | Publicación real (fase 4) | Según plan vigente de X (por verificar) |
| API key de Anthropic | Generación con Claude (fase 3) | Por uso; limitado por `DAILY_BUDGET_USD` |
| Postgres gestionado y hosting | Piloto (fase 5) | Plan gratuito o bajo coste |

## Criterios de aceptación (sección 21)

| # | Criterio | Estado |
| --- | --- | --- |
| 1 | Recomendaciones con fuentes reales | ⏳ Fase 2 (hoy: demostración) |
| 2 | Relevancia explicada con evidencias | ✅ |
| 3 | Exclusiones impiden temas prohibidos | ✅ (probado) |
| 4 | Voz versionada identificable en borradores | ✅ (probado) |
| 5 | Notificación llega al teléfono y abre la propuesta | ✅ en código y probado en simulado · ⏳ prueba real en el iPhone pendiente del token |
| 6 | Aprobar y publicar desde el móvil | ✅ (publicación simulada) |
| 7 | Se publica exactamente la versión y cuenta aprobadas | ✅ (probado) |
| 8 | Doble pulsación o reintento no duplican | ✅ (probado) |
| 9 | Modificar invalida la aprobación | ✅ (probado) |
| 10 | Aislamiento entre organizaciones | ✅ (probado en la capa de negocio) |
| 11 | Fallo de fuente ≠ pérdida de interés | ✅ en el motor (probado) · conectores en fase 2 |
| 12 | Envío incierto no se marca como exitoso | ✅ (probado) |
| 13 | Programadas sobreviven a reinicios | ✅ (probado) |
| 14 | Límites de consumo detienen antes de exceder | ✅ para generación (probado) |
| 15 | Simulaciones claramente identificadas | ✅ |

## Limitaciones conocidas

- **Fuentes:** solo acontecimientos de demostración. No hay recolección, deduplicación ni agrupación automática todavía (fase 2); tampoco la unión/separación manual de agrupaciones (la tabla `event_corrections` ya existe).
- **Búsqueda semántica:** no implementada (pgvector en fase 2).
- **Generación:** plantillas. Sin inferencia de voz a partir de textos (fase 3). La generación automática por reglas tiene su configuración en el modelo (`brands.auto_generation`) pero aún no se ejecuta.
- **Recursos visuales:** el modelo los soporta (`draft_versions.assets`) pero no hay subida de archivos.
- **Publicación:** solo X, simulada.
- **Corrección material de evidencia:** `flagDraftsForEvidenceChange` existe, pero todavía no hay un proceso que versione la evidencia (fase 2).
- **Identidad:** sin recuperación de contraseña, invitaciones ni límite de intentos de inicio de sesión (fase 5).
- **Seguridad pendiente:** cifrado de tokens de redes sociales, validación SSRF de URLs de RSS (con los conectores), límites de tamaño/tipo de adjuntos (con la subida de archivos), políticas de conservación por fuente.
- **Observabilidad:** métricas básicas en base de datos; sin trazas ni alertas externas.
- **Push web:** no implementado (se eligió Telegram).
