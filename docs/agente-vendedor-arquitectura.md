# Sentinel — Agente Vendedor de Apoyo (arquitectura y roadmap)

> Creado: 2026-07-12. Documento de diseño para converger dos esfuerzos que hoy
> corren en paralelo: **Sentinel** (percepción y juicio sobre el funnel) y el
> **agente de seguimiento** prototipado como prompt sobre GHL MCP (ejecución
> con lógica de rondas). Objetivo final: un agente que sea un vendedor de
> apoyo real — que genere acciones directamente y se coordine con el vendedor
> humano.

## 1. Visión y principio rector

Un solo sistema con tres capas, donde cada capa puede evolucionar sin romper
las otras:

| Capa | Qué hace | Dónde vive hoy |
|---|---|---|
| **Percepción** | Sync del funnel, riesgo, benchmarks, outcome tracking | Sentinel (`deal-sync`, `live-opp-engine`, `won-track-engine`, `outcomes`) |
| **Decisión** | Qué acción corresponde a cada deal ahora | Parcial: recomendaciones de texto libre en Live Opp + reglas de rondas hardcodeadas en el prompt del agente |
| **Ejecución + coordinación** | Ejecutar la acción y coordinarse con el vendedor humano | Parcial: 1-click Forense→GHL en Sentinel; todo lo demás en el prototipo externo |

**Principio rector: la autonomía se gana con evidencia.** El agente parte
recomendando, después ejecuta con aprobación, y solo ejecuta solo cuando el
outcome tracking demuestra que ese tipo de acción funciona. Los umbrales de
los playbooks salen de los datos de Won Track (benchmarks reales won/lost),
no de números mágicos.

**Fuente de verdad: la BD de Sentinel.** GHL es la interfaz con el humano
(notas, tareas, tags visibles para el vendedor), no el lugar donde vive el
estado del agente. Los custom fields `ai_*` del prototipo son espejo de
visibilidad, nunca el registro primario.

## 2. Qué aporta cada esfuerzo (y qué no se traslada)

**Sentinel aporta** (ya en prod): sync multi-tenant GHL→BD (`deals` /
`deal_messages`), riesgo calibrado con thresholds del tenant, benchmarks
won/lost segmentados, taxonomía canónica (`taxonomy.ts`), LLM por tier con
caché y metering, rate limiting GHL, crons con `CRON_SECRET`, outcome
tracking (`recommendation_events`), y helpers de escritura en GHL
(`addContactTags`, `createContactTask`).

**El prototipo (prompt del agente) aporta** el modelo de decisión:

- **Lógica de rondas**: la acción depende de la etapa + antigüedad
  (Demo/Instalado: <7d activación, 7–14d retención, >14d empujar cierre;
  Calificado sin gestión >7d: tarea al vendedor; Recibido viejo: escalar
  intentos → cambiar canal → mover a Frío).
- **Contador de intentos con escalada** (0–2 contactar, 3–5 último intento +
  cambio de canal, >5 a Frío).
- **Acciones tipificadas** (CONTACTAR, CREAR_TAREA_VENDEDOR, MOVER_A_FRIO,
  EN_GESTION_NO_TOCAR) en vez de consejos de texto libre.
- **Convenciones de coordinación embrionarias**: notas `[AGENTE]`, tag
  `ai-pausado`, aprobación humana obligatoria, horario 9:00–19:00 Chile.

**No se traslada**: IDs hardcodeados de CentralGPS (pipeline, stages, custom
fields), precios de planes en el prompt, y el estado en custom fields como
fuente de verdad. Todo eso pasa a config por tenant + BD.

## 3. Máquina de estados: ¿quién es dueño del deal?

Cada deal abierto tiene un **owner de gestión** en todo momento. Es la pieza
que hoy no existe en ninguno de los dos sistemas y la que hace posible la
coordinación real.

```
                    ┌─────────────┐
        asignación  │   humano    │  (default: todo deal nuevo)
       ┌───────────►│  (vendedor) │◄──────────────┐
       │            └──────┬──────┘               │
       │                   │ vendedor delega       │ vendedor retoma
       │                   │ o regla lo asigna     │ (o toca el deal)
       │            ┌──────▼──────┐               │
       │            │   agente    │───────────────┘
       │            └──────┬──────┘
       │                   │ señal que requiere humano
       │            ┌──────▼──────┐
       └────────────│  escalado   │  (agente creó tarea, espera al humano)
        tarea       └──────┬──────┘
        resuelta           │ pausa manual (tag ai-pausado / ai_estado)
                    ┌──────▼──────┐
                    │   pausado   │  (nadie automatiza; solo humano)
                    └─────────────┘
```

**Implementación (decidido 2026-07-12): Contact Owner nativo de GHL.** Se
crea un usuario "Agente IA" en la location y el eje humano/agente se
materializa con el `assignedTo` del **contacto**:

- Owner del contacto = Agente IA → la conversación sale del inbox y de las
  notificaciones del vendedor; los workflows pueden filtrar por assigned
  user para enrutar respuestas del cliente al agente.
- La **oportunidad conserva el `assignedTo` del vendedor humano** siempre:
  el deal sigue en su pipeline, la atribución no cambia y el digest de
  Sentinel (que agrupa por `deal.assignedTo`) le sigue reportando a la
  persona correcta. Nunca reasignar la oportunidad al agente (reeditaría el
  bug de wrong-recipient del digest).
- El agente envía mensajes con su propio `userId` → cada outbound queda
  firmado nativamente como del agente, sin heurísticas.

Reglas de transición clave:

- **Actividad humana revoca al agente**: si el vendedor envía un mensaje en
  una conversación con owner Agente IA, o se reasigna el contacto, el deal
  vuelve a `humano`. Detección directa: `userId` del mensaje ≠ usuario
  agente. Es el `EN_GESTION_NO_TOCAR` del prototipo, pero derivado de datos.
- **El agente nunca se auto-asigna deals calientes**: deals con inbound
  reciente del cliente o en etapas de cierre son siempre `humano` o
  `escalado`; el agente toma lo que el humano no está trabajando (leads
  fríos, sin gestión, envejecidos).
- **`escalado`** = owner del contacto vuelve al vendedor + tarea GHL con
  contexto. **`pausado`** sigue siendo el tag `ai-pausado` (estado
  transversal, no un dueño) y solo lo levanta un humano.

Sentinel lee el ownership desde el sync (owner del contacto + userId de los
mensajes); la tabla `deal_ownership` guarda el historial de transiciones
para auditoría y métricas, no es la fuente operativa. Precaución operativa:
verificar que ningún workflow de distribución de leads existente reasigne
el owner por encima del agente.

## 4. Taxonomía de acciones

Extiende `taxonomy.ts` con un catálogo cerrado (mismo patrón que
`RISK_SIGNALS` / `INTENT_SIGNALS`):

```ts
export const AGENT_ACTIONS = [
  'contactar_cliente',      // mensaje saliente al cliente (WhatsApp/email)
  'ultimo_intento',         // último mensaje + cambio de canal
  'mover_a_frio',           // mover etapa + nota con motivo
  'crear_tarea_vendedor',   // tarea en GHL asignada al ejecutivo
  'crear_nota',             // registrar hallazgo/acción en la oportunidad
  'escalar_a_humano',       // tarea prioritaria + notificación al vendedor
  'no_tocar',               // en gestión humana / pausado / fuera de horario
  'monitorear',             // sin acción; re-evaluar en el próximo ciclo
] as const;
```

Cada acción lleva metadata: **nivel de riesgo** (¿toca al cliente o solo al
CRM?), **reversibilidad**, y **nivel mínimo de autonomía** requerido para
ejecutarla sin aprobación. `contactar_cliente` y `ultimo_intento` son las
únicas que hablan con el cliente — son las últimas en ganar autonomía.

## 5. Motor de playbooks (capa de decisión)

Módulo nuevo `src/lib/playbook-engine.ts`: función pura
`decideAction(deal, messages, analysis, ownership, thresholds) →
PlaybookDecision { action, params, rationale, requiresApproval }`.

- **Input**: el mismo `Deal` canónico + `analyzeLiveOpportunity` (riesgo) +
  estado de ownership + thresholds del tenant.
- **Rondas portables**: las reglas del prototipo se reescriben sobre
  `FUNNEL_STAGES` canónicas (`consulta_inicial`, `cotizacion`,
  `demo_plataforma`, `negociacion`, …), no sobre stage IDs de GHL. El mapeo
  stage→canónico ya existe por tenant (Fase 1).
- **Intentos derivados, no declarados**: los "intentos" se calculan del
  historial sincronizado (mensajes outbound consecutivos sin respuesta
  inbound), no de un custom field. `deal_messages` ya tiene todo.
- **Umbrales desde datos**: los "7 días", "14 días", "N intentos" arrancan
  con los valores del prototipo como default, pero se parametrizan por
  tenant y se recalibran con los benchmarks de Won Track (p. ej. "mover a
  frío" cuando el deal supera el p75 de días-hasta-primer-inbound de los
  deals ganados).
- Determinista y testeable (como `classifyIntent` de split-funnel). El LLM
  entra después, solo para **redactar** el mensaje de una acción ya
  decidida, nunca para decidir la acción.

## 6. Niveles de autonomía

Config por tenant (en `app_settings`), por **tipo de acción**:

| Nivel | Comportamiento | Ejemplo de arranque |
|---|---|---|
| **A0 — Recomienda** | La acción aparece en el digest/dashboard; el humano ejecuta fuera | Todo al inicio (es el digest de hoy) |
| **A1 — Ejecuta con aprobación** | Acción propuesta con botón de ejecución 1-click (patrón Forense→GHL) o aprobación por WhatsApp | `crear_tarea_vendedor`, `crear_nota` |
| **A2 — Ejecuta y reporta** | Ejecuta solo, deja nota `[AGENTE]` y aparece en el digest como "hecho" | `crear_tarea_vendedor`, `mover_a_frio` tras N intentos |
| **A3 — Autónomo con guardrails** | Ejecuta incluso contacto al cliente dentro de límites duros | `contactar_cliente` en leads `consulta_inicial` viejos, con plantilla aprobada |

Promoción de nivel = decisión humana **informada por outcome tracking**: la
tarjeta "Impacto de las recomendaciones" (P2) se segmenta por tipo de acción
y por ejecutor (agente vs humano). Cuando `mover_a_frio` automático lleva un
mes sin falsos positivos, se sube de A1 a A2 con un toggle en Settings.

Guardrails duros independientes del nivel (heredados del prototipo):

- Horario de contacto al cliente: 9:00–19:00 America/Santiago (config).
- `pausado` / tag `ai-pausado` bloquea todo.
- Presupuesto de contactos: máx. N mensajes salientes por deal y por día por
  tenant (evita loops y spam).
- Nunca contactar si hay inbound del cliente sin responder (eso es del
  humano o de un playbook de respuesta, no de seguimiento).

## 7. Coordinación con el vendedor humano

El vendedor no debe necesitar abrir Sentinel para convivir con el agente.
Tres canales, todos ya parcialmente construidos:

1. **GHL como espejo**: toda acción del agente deja nota `[AGENTE] fecha —
   acción — detalle` en la oportunidad y tags de estado. El vendedor ve en
   su CRM de siempre qué hizo el agente y por qué.
2. **Digest WhatsApp como resumen bidireccional**: el digest matinal
   (`digest.ts`) evoluciona de "tus deals en riesgo" a tres secciones:
   *lo que el agente hizo ayer por ti*, *lo que necesita tu aprobación*,
   *lo que solo tú puedes hacer* (escalados). El deal en gestión del agente
   deja de aparecer como "en riesgo sin acción" — se acabó el doble toque.
3. **Tareas GHL como handoff**: `escalar_a_humano` y `crear_tarea_vendedor`
   usan `createContactTask` con vencimiento; la resolución (o vencimiento)
   de la tarea transiciona el ownership.

Aprobaciones (nivel A1): primera versión con los botones 1-click en el
dashboard (ya existe el patrón y registra `recommendation_events`).
Extensión futura: aprobar respondiendo el WhatsApp del digest (requiere
webhook de Meta para inbound — hoy solo enviamos).

### Continuación de la conversación tras el HSM (decidido 2026-07-12)

Capacidad HSM **ya probada end-to-end** vía API pública de GHL
(`POST /conversations/messages` + objeto `whatsapp.template`; dos entregas
confirmadas 12-jul). La respuesta del cliente abre la ventana de 24h, dentro
de la cual el mismo endpoint envía mensajes libres. Quién continúa, en
secuencia:

1. **Ahora — el vendedor humano**: el agente solo inicia (HSM) y notifica;
   la respuesta la toma el vendedor (notificación nativa de GHL). Sentinel
   ya mide tiempos de respuesta → esta fase cuantifica cuántas ventanas de
   24h se desperdician, que es la evidencia para la fase siguiente.
2. **Piloto — Claude Managed Agent por conversación**: workflow GHL
   (trigger Customer Replied + filtro assigned user = Agente IA) → webhook
   → sesión del agente con contexto del deal (consultable a la API de
   Sentinel). Solo cohorte de bajo riesgo (Recibido viejos, Ronda 4); el
   resto escala a humano.
3. **Alicia (Conversation AI de GHL) solo como derivadora**: si la
   respuesta revela una intención nueva, se deriva a su flujo de
   calificación. No continúa seguimientos (perdería el contexto del deal).
4. **Agente dentro de Sentinel**: descartado por ahora (requeriría
   webhooks entrantes, sesiones y colas que Sentinel no tiene); Sentinel
   participa como cerebro consultable, no como anfitrión del chat.

## 8. Modelo de datos (nuevas tablas)

- **`deal_ownership`** — owner vigente por deal: `tenant_id`, `deal_id`,
  `owner` (`humano|agente|escalado|pausado`), `reason`, `since`, `actor`.
- **`agent_actions`** — cola y bitácora de ejecución: `id`, `tenant_id`,
  `deal_id`, `action` (taxonomía §4), `params` (jsonb: mensaje redactado,
  canal, stage destino…), `status`
  (`proposed|approved|executed|rejected|expired|failed`), `decided_by`
  (regla/LLM), `approved_by`, `executed_at`, `ghl_refs` (jsonb: ids de
  nota/tarea/mensaje creados), `error`.
- **`recommendation_events`** (existente) se generaliza: hoy registra el
  1-click de Forense; pasa a registrar también las acciones del agente para
  que `getOutcomeStats` compare por tipo de acción y ejecutor.
- Contadores como `intentos` **no se persisten**: se derivan de
  `deal_messages` en cada evaluación (una fuente de verdad menos que se
  desincroniza).

## 9. Roadmap por fases

Cada fase es deployable sola y deja valor aunque la siguiente no se haga.

### AG-1 — Digest accionable (decisión sin ejecución)

- `playbook-engine.ts` con rondas canónicas + intentos derivados + acciones
  tipificadas. Tests puros como los de `split-funnel`.
- El digest y Live Opp muestran `action` + `rationale` del playbook en vez
  de (o además de) las recomendaciones de texto libre.
- Sin migración de GHL-escritura nueva; migración BD solo si se quiere
  registrar la recomendación mostrada (extensión ya anotada en P2).
- **Riesgo: nulo** (solo cambia qué se recomienda). Es el "twist" del digest
  discutido el 2026-07-12.

### AG-2 — Ejecución con aprobación (A1)

- Tablas `agent_actions` + `deal_ownership` (migración).
- Botones de ejecución en Live Opp/digest-web para `crear_tarea_vendedor`,
  `crear_nota`, `mover_a_frio` (helpers nuevos en `ghl-client.ts`:
  `createOpportunityNote`, `updateOpportunityStage` — payloads de referencia
  en el MCP `prod-ghl-cmp-mcp`).
- Toda ejecución escribe nota `[AGENTE]` + `recommendation_events`.

### AG-3 — Autonomía CRM (A2) + ownership activo

- Cron del agente (nuevo runner en `engine-runners.ts`, mismo patrón
  `runXForTenant` + `CRON_SECRET`): evalúa playbooks y ejecuta solo las
  acciones cuyo tipo esté en A2 para ese tenant; el resto queda `proposed`.
- Detección de actividad humana en el sync → transiciones automáticas de
  ownership; el digest pasa al formato de tres secciones (§7.2).
- Settings: matriz acción×nivel por tenant.

### AG-4 — Contacto directo al cliente (A3)

- `contactar_cliente` / `ultimo_intento` ejecutados por el agente vía la
  infra WhatsApp existente (`whatsapp.ts`) o mensajes GHL, con redacción LLM
  (firma con nombre del ejecutivo vía `fetchUserById`, como el digest).
- Solo para cohortes de bajo riesgo definidas por datos (p. ej. leads
  `consulta_inicial` > p75 de antigüedad sin inbound) y bajo todos los
  guardrails de §6.
- Prerrequisito de evidencia: outcome de AG-2/AG-3 revisado; comparar tasa
  de recuperación agente vs humano antes de encender.

### Mientras tanto: el prototipo sigue vivo

El prompt actual (agente paralelo con aprobación manual de Francisco) sigue
operando como **laboratorio de playbooks**: es barato iterar reglas ahí y
portarlas a `playbook-engine.ts` cuando demuestran valor. Regla de
convivencia hasta AG-3: el prototipo deja siempre nota `[AGENTE]` y tag; el
digest de Sentinel excluye (o marca "en gestión por agente") los deals con
esa señal para evitar doble toque. Cuando AG-3 esté en prod, el prototipo se
apaga y sus reglas ya viven versionadas y testeadas en el repo.

## 10. Decisiones abiertas y resueltas

Resueltas (2026-07-12):

- ~~Canal de envío en AG-4~~ → **GHL conversations**, probado end-to-end:
  la API pública envía HSM (plantillas WhatsApp) y, dentro de la ventana de
  24h, mensajes libres. Todo queda en el hilo del CRM. Usar plantillas
  categoría **Utility** (las Marketing chocan con caps y el experimento de
  Meta, error 130472). Payload probado documentado en memoria del proyecto.
- ~~Detección de autor humano vs agente~~ → resuelto por diseño: el agente
  es un **usuario GHL propio** y firma sus mensajes con su `userId` (§3).
- ~~Quién continúa la conversación tras el HSM~~ → secuencia de §7:
  vendedor humano ahora, Claude Managed Agent como piloto, Alicia solo
  deriva, Sentinel no hospeda el chat.

Abiertas:

1. **Aprobación por WhatsApp** (responder al digest): requiere webhook
   inbound de Meta; evaluar costo/beneficio en AG-2 vs quedarse en botones
   web.
2. **Multi-tenant del playbook**: las rondas del prototipo son de
   CentralGPS; definir cuánto es default universal vs config por tenant
   (propuesta: estructura universal sobre etapas canónicas, umbrales por
   tenant).
3. **Convivencia con workflows existentes**: auditar workflows de
   distribución/reasignación de leads y a Alicia (Conversation AI) para que
   no pisen el owner Agente IA ni respondan conversaciones en gestión del
   agente.
4. **Timeout del agente conversacional**: si el cliente responde y el
   Managed Agent no contesta en N minutos, reasignar al vendedor con tarea
   (fail-safe humano).
