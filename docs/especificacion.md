# Especificación del proyecto: SaaS de tendencias y contenido para Community Managers

> Documento base entregado por el propietario (2026-09-16). Añadido del propietario: **debe llegar una notificación al teléfono para poder publicar desde ahí.**

## 1. Encargo

Construir un SaaS que ayude a Community Managers, freelancers y agencias a responder: **¿Qué debería publicar hoy mi marca y por qué?**

El producto debe descubrir acontecimientos relevantes, preparar contenido con la voz de cada marca, enviar una notificación al teléfono y permitir aprobar y publicar rápidamente.

### Forma de trabajar

1. Inspeccionar el repositorio y las instrucciones existentes antes de modificar archivos.
2. Si existe una implementación, identificar qué puede reutilizarse.
3. Definir el stack y justificar brevemente las decisiones antes de implementar.
4. Trabajar por fases que produzcan resultados verificables.
5. Evitar infraestructura que el MVP todavía no necesita.
6. Distinguir claramente las integraciones reales de las simuladas.
7. No presentar una función como operativa si depende de credenciales o permisos pendientes.
8. Si falta una credencial, continuar con un adaptador simulado y documentar cómo activar el real.
9. Preguntar solo por decisiones que cambien sustancialmente el alcance, impliquen gasto o requieran acceso del propietario.
10. La publicación en cuentas reales queda desactivada hasta que el propietario conecte y habilite explícitamente esas cuentas.

## 2. Resultado esperado

El usuario configura su marca una vez: industria y nicho, audiencia, idioma y zona horaria, temas de interés, temas excluidos, referentes, fuentes a monitorizar, voz y posicionamiento, cuentas de publicación y preferencias de notificación.

Después el sistema:

1. Recopila señales.
2. Agrupa publicaciones sobre un mismo acontecimiento.
3. Detecta cuáles están ganando relevancia.
4. Calcula su afinidad con la marca.
5. Prepara una propuesta de contenido cuando cumple los criterios configurados.
6. Envía una notificación al teléfono.
7. Permite revisar, editar, aprobar, programar o descartar.
8. Publica únicamente una versión aprobada.
9. Confirma el resultado.
10. Usa el feedback para mejorar las recomendaciones.

La experiencia móvil de aprobación es parte esencial del MVP.

## 3. Alcance del MVP

**Incluido:** registro e inicio de sesión; organizaciones con usuarios y marcas; roles básicos; intereses, exclusiones y referentes; perfil de voz editable; monitorización de fuentes disponibles; agrupación por acontecimientos; histórico de métricas; Trend Score explicable; relevancia personalizada por marca; dashboard de tendencias; ficha de investigación con fuentes; generación manual y automática configurable de borradores; editor; notificaciones al teléfono; aprobación rápida desde móvil; publicación inmediata o programada en un canal inicial; historial de publicaciones y errores; feedback de utilidad; límites de consumo y costes.

**Fuera del MVP:** apps nativas iOS/Android; publicación en todas las redes; generación y edición completa de vídeo; diseño avanzado de carruseles; social listening general; respuestas automáticas; entrenamiento de modelos propios; analítica avanzada de atribución; publicación autónoma sin aprobación humana; microservicios distribuidos. Los guiones de vídeo y carruseles pueden generarse como texto.

## 4. Arquitectura general

Backend modular con trabajadores en segundo plano. Componentes: aplicación web adaptable a móvil, backend, trabajadores, cola duradera, programador de tareas, base de datos relacional, búsqueda semántica, almacenamiento de archivos, servicio de notificaciones, gestor de secretos y observabilidad.

**Capa compartida** (solo si las condiciones de las fuentes lo permiten): señales públicas, acontecimientos, históricos, evaluaciones de tendencia, fichas neutrales de evidencia.

**Capa privada por organización:** marcas y miembros, documentos y voz, fuentes privadas, recomendaciones, borradores, conexiones sociales, aprobaciones, publicaciones, feedback. No se mezclan documentos, búsquedas, cachés ni resultados privados de organizaciones distintas.

## 5. Módulos

1. Identidad y organizaciones. 2. Marcas y voz. 3. Fuentes y referentes. 4. Recolección. 5. Normalización y deduplicación. 6. Acontecimientos y evidencias. 7. Tendencias y recomendaciones. 8. Generación y edición. 9. Aprobaciones. 10. Notificaciones. 11. Programación y publicación. 12. Feedback y analítica. 13. Consumo, auditoría y operación.

## 6. Organizaciones y permisos

Organización → Marcas → Contenido y cuentas sociales. Un usuario puede pertenecer a varias organizaciones.

| Rol | Capacidades |
| --- | --- |
| Propietario | Organización, miembros, conexiones y configuración |
| Editor | Investigar, generar y editar borradores |
| Aprobador | Revisar, aprobar, programar y autorizar publicación |

Una persona puede tener varios roles; un freelancer completa todo el flujo solo. El backend verifica permisos en cada operación.

## 7. Perfil de marca

Comercial/editorial: nombre, descripción, industria, productos o servicios, audiencia, mercado, idioma, zona horaria, objetivos, posicionamiento, intereses, exclusiones, referentes.

Voz: formalidad, nivel técnico, longitud, emojis, expresiones habituales, palabras prohibidas, aperturas y cierres, llamadas a la acción, ejemplos aprobados. Los rasgos inferidos se validan con el usuario. La voz se versiona y cada borrador registra la versión usada.

## 8. Fuentes e integraciones

Previstas: RSS y medios, Hacker News, GitHub, X, Reddit. Antes de implementar cada una, verificar documentación oficial, permisos, costes, límites y condiciones de conservación y uso con IA. X o Reddit no deben bloquear el resto.

Cada conector: declara capacidades; recopila incrementalmente; registra su punto de avance; respeta límites y presupuestos; identifica datos modificados o eliminados; registra fallos y última ejecución exitosa; indica sus métricas; diferencia "sin resultados" de "fallo de acceso".

Política: frecuencia configurable, reintentos con espera progresiva, concurrencia limitada por proveedor, priorización de fuentes activas, pausa por presupuesto, visibilidad de cobertura y frescura. Los referentes usan identidades explícitas por plataforma.

## 9. Señales y acontecimientos

**Señal:** fuente e ID externo, URL, autor, fecha original y de descubrimiento, contenido permitido, idioma, entidades, métricas (como observaciones históricas), restricciones de uso, procedencia pública o privada.

**Acontecimiento:** un hecho concreto al que se vinculan señales ("una empresa presenta una función", no "inteligencia artificial").

**Agrupación:** URLs y duplicados, similitud semántica, entidades, cercanía temporal, tipo, relaciones entre fuentes. Distinguir reproducciones de un comunicado de conversaciones independientes. Permitir unir y separar con trazabilidad.

## 10. Motor de tendencias

Tres resultados separados.

**Fuerza:** velocidad 30 %, diversidad 20 %, novedad 15 %, engagement normalizado 15 %, autoridad temática 10 %, referentes 10 %. Pesos configurables y versionados.

**Afinidad:** intereses, audiencia, producto, referentes, idioma y mercado, feedback previo. Exclusiones antes de ordenar.

**Prioridad editorial:** fuerza, afinidad, actualidad, confianza, contenido ya publicado o preparado.

Reglas: ventanas equivalentes; normalizar por plataforma; evitar % engañosos con bases pequeñas; métricas ausentes ≠ cero; menos confianza con menos cobertura; separar caída de actividad de caída de recolección; guardar factores; la afinidad no es una probabilidad. El ranking es reproducible; el modelo de lenguaje puede clasificar y explicar, no inventar métricas.

## 11. Ficha de investigación

Título, qué ocurrió, fuente original, fuentes adicionales, hechos confirmados, aspectos inciertos, evolución, participantes, perspectivas, fecha de actualización. Cada afirmación importante con respaldo. "Por qué importa a tu marca" se genera en la capa privada. Si la evidencia es insuficiente, se indica. No inventar fuentes, citas, cifras ni opiniones.

## 12. Generación de contenido

Entradas: versión de evidencia, perfil y voz, ejemplos, canal, formato, objetivo, ángulo, contenido reciente. Salidas: texto, recursos, referencias, ángulo, observaciones para revisión, versiones de evidencia y voz. Modos: informativo, educativo, técnico, sencillo, opinión basada en posicionamiento, noticia urgente. No atribuir opiniones no definidas; proponer alternativas.

Generación automática por marca: umbral de prioridad, confianza mínima, límite diario, canales, horarios, control de duplicados, presupuesto. Una tendencia puede no generar borrador; un borrador puede no generar aviso.

## 13. Notificaciones y aprobación rápida

Flujo: oportunidad → borrador → notificación → abrir propuesta → revisar contenido, marca y destino → **Aprobar y publicar** → publicación y confirmación con enlace. Sin segunda confirmación tras un botón explícito.

Pantalla móvil: marca, plataforma y cuenta, texto completo, recursos, motivo, fuente, actualidad, estado. Acciones: aprobar y publicar, programar, editar, descartar.

Proveedor intercambiable; validar compatibilidad con el teléfono del propietario, permisos, entrega con la app cerrada, coste y asociación del destinatario. La entrega real debe probarse.

Reglas: abrir un enlace nunca aprueba ni publica; aprobar exige identidad y permisos; un enlace reenviado no da acceso; respetar horarios y límites; no repetir avisos; no recordar lo resuelto; bandeja de pendientes aunque falle el aviso; aceptación del proveedor ≠ lectura; mínimos datos sensibles en pantalla bloqueada.

## 14. Aprobaciones y publicación

Estados: Borrador → En revisión → Aprobado → Programado o En cola → Publicando → Publicado. Alternativos: Rechazado, Cancelado, Requiere nueva revisión, Fallido, Resultado pendiente de confirmar.

Reglas: la aprobación autoriza una versión exacta; cambiar texto, recursos o destino la invalida; una corrección material de la evidencia obliga a revisar lo no publicado; solo un aprobador autoriza; sin duplicados por pulsaciones o trabajos repetidos; registrar intentos y respuestas; ante timeout ambiguo, comprobar antes de reintentar; si no se puede comprobar, detener y mostrar estado incierto; programadas en la zona de la marca con instante inequívoco; verificar credenciales antes de enviar; mostrar enlace externo al confirmar. Aprobación y solicitud de envío se registran de forma consistente.

## 15. Modelo de datos

Acceso (organización, usuario, membresía, permisos) · Marca (marca, perfil, versión de voz, ejemplo) · Monitorización (fuente, referente, suscripción, ejecución) · Señales (señal, medición, procedencia, restricciones) · Acontecimientos (acontecimiento, relación, evidencia, versiones) · Recomendaciones (evaluación, recomendación por marca, explicación) · Contenido (borrador, versión, recurso, referencias) · Aprobación (decisión, aprobador, versión, fecha) · Entrega móvil (destinatario, preferencias, notificación, intentos) · Publicación (conexión, envío programado, intento, resultado) · Operación (feedback, consumo, auditoría, trabajos). Aislamiento por organización en todos los datos privados, incluidos archivos y búsquedas semánticas.

## 16. Pantallas

1. Inicio de sesión y organización. 2. Configuración inicial de marca. 3. Radar (publicar hoy, observar, perdiendo fuerza). 4. Detalle de acontecimiento. 5. Editor. 6. Aprobación móvil. 7. Bandeja de pendientes. 8. Calendario. 9. Historial. 10. Voz y ejemplos. 11. Fuentes y referentes. 12. Conexiones sociales y notificaciones. 13. Miembros y permisos. 14. Estado operativo y consumo. Todas con estados de carga, vacío, error y acceso denegado.

## 17. Seguridad

Credenciales solo en servidor; tokens en gestor de secretos o cifrados; autorización por organización y rol; auditoría de aprobaciones, conexiones y publicaciones; datos privados fuera de logs innecesarios; contenido externo como información, nunca instrucciones; límites de tamaño y tipo en adjuntos; conservación por fuente; eliminación de datos y derivados; validación de URLs contra acceso a servicios internos (SSRF); copias de seguridad con prueba de restauración. La IA no puede aprobar, cambiar permisos ni publicar.

## 18. Costes y observabilidad

Registrar consultas por fuente, uso de modelos, coste por organización, borradores, notificaciones, retraso de recolección, trabajos pendientes y fallidos, tiempo hasta publicación, fallos y ambiguos, recomendaciones aceptadas o descartadas. Cuotas antes de operaciones costosas. Reutilizar análisis compartidos; contenido personalizado bajo demanda o por reglas limitadas. Feedback explícito y resultado editorial por separado.

## 19. Estructura del repositorio

Aplicación web, backend, trabajadores, dominio compartido, integraciones, persistencia, pruebas, infraestructura, documentación. Sin duplicar reglas de aprobación entre capas.

## 20. Plan por fases

- **Fase 0 — Decisiones y base:** entorno, stack, modelo de datos y estados, viabilidad de fuentes, canal de notificación y primera red, credenciales y costes pendientes.
- **Fase 1 — Recorrido móvil completo** con señales de demostración: crear marca, borrador, notificación real, revisión móvil, aprobación, publicación simulada, resultado e historial.
- **Fase 2 — Radar real:** fuentes viables, normalización, deduplicación, agrupación, históricos, tendencia y afinidad, evidencia y cobertura.
- **Fase 3 — Contenido y voz:** voz, ejemplos, generación con evidencia, edición y versionado, propuestas automáticas con límites.
- **Fase 4 — Publicación real:** cuenta autorizada, versiones aprobadas, programación, errores, credenciales vencidas, ambiguos, enlaces.
- **Fase 5 — Piloto:** aislamiento, permisos, cuotas, auditoría, observabilidad, recuperación, copias de seguridad, documentación operativa.

## 21. Criterios de aceptación

1. Recomendaciones basadas en fuentes reales tras configurar una marca.
2. Cada recomendación explica su relevancia y muestra evidencias.
3. Las exclusiones impiden temas prohibidos.
4. Los borradores usan una versión identificable de la voz.
5. La notificación llega al teléfono y abre la propuesta correcta.
6. Se puede aprobar y publicar desde el móvil sin el dashboard de escritorio.
7. La publicación corresponde exactamente a la versión y cuenta aprobadas.
8. Doble pulsación o reintento no duplican.
9. Una modificación invalida la aprobación previa.
10. Una organización no accede a datos privados de otra.
11. Un fallo de fuente no se presenta como pérdida de interés.
12. Un envío incierto no se marca como exitoso.
13. Las programadas sobreviven a un reinicio.
14. Los límites de consumo detienen operaciones antes de exceder el presupuesto.
15. Integraciones pendientes y simulaciones claramente identificadas.

## 22. Entregables

Proyecto ejecutable; arquitectura; decisiones; modelo de datos y migraciones; configuración de ejemplo sin secretos; integraciones reales y simuladas identificadas; pruebas de recorridos críticos; instalación y ejecución; guía para conectar fuentes, teléfono y cuentas; despliegue y recuperación; limitaciones y requisitos pendientes.

**Prioridad:** detectar algo relevante, preparar contenido útil, avisar al teléfono y publicar la versión aprobada de forma fiable.
