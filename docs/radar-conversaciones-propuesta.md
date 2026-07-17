# Propuesta: Radar de Conversaciones (módulo nuevo)

> Estado: propuesta técnica (2026-07-17). Nombre de trabajo: **Radar**. Pendiente
> de aprobación de alcance antes de codear.

## 1. El problema

Live Opp y el digest son **opportunity-driven**: parten de
`fetchOpportunities(status='open')` del pipeline de ventas y solo analizan la
conversación de contactos que **ya tienen una oportunidad creada** en GHL. El
"carácter de venta" (los `intentSignals` regex) se calcula únicamente sobre esos
contactos.

Consecuencia: **una conversación de WhatsApp con clara intención de compra pero
sin oportunidad creada es invisible** para Sentinel hoy. Son justo las que "se
pierden" — el dolor central del negocio: el vendedor no da abasto y la
conversación se cae **antes** de entrar al pipeline.

### Tamaño del hueco (datos reales de CentralGPS, 2026-07-17)

| Universo | Cantidad |
|---|---|
| Conversaciones en la location (`conversations/search` → `total`) | **4.450** |
| Oportunidades `open` en el pipeline de ventas | ~534 |
| En la cola de Live Opp (en riesgo) | ~44 |

Es decir: miles de conversaciones fuera del radar. Aunque una fracción sea
soporte/postventa, el volumen de intención de compra no capturada es enorme.

## 2. ¿Módulo nuevo o parte de Live Opp?

**Módulo nuevo**, compartiendo plomería. Razones:

- **Unidad de análisis distinta:** Live Opp está keyed por *oportunidad* (motor
  de riesgo, playbook, KPIs, acciones 1-click, todo asume un deal). Radar está
  keyed por *conversación/contacto*, que puede no tener deal. Injertarlo forkearía
  el modelo de datos de Live Opp y ensuciaría ambos.
- **Job-to-be-done distinto:** Live Opp = "no soltar lo que ya está en el
  pipeline". Radar = "pescar la conversación de venta que nunca entró (o se
  cayó)". Acciones distintas: **crear oportunidad / asignar / responder**, no
  avanzar un deal.
- **Modelo mental limpio:** un motor hermano en el nav (Forense · Live Opp · Won
  Track · Split Funnel · **Radar**).

Comparten: `INTENT_PATTERNS`, config de IA por tier (`resolveWorkingAIConfig`),
caché LLM (`llm_analysis`), dedupe contra `deals`, el executor AG-2
(`agent_actions`) y el digest matinal.

## 3. Cómo funciona el `conversations/search` de GHL (verificado)

`GET /conversations/search` (scope `conversations.readonly`) lista **por
location** y devuelve por conversación, entre otros:

- `contactId`, `contactName`, `phone`, `email`
- `lastMessageBody` (**el texto del último mensaje, inline**) ← permite
  clasificar sin traer cada hilo
- `lastMessageType` (`TYPE_WHATSAPP`…), `lastMessageDirection`
  (`inbound`/`outbound`), `lastMessageDate`, `lastInboundWhatsappMessageDate`
- `unreadCount` (mensajes sin leer por el equipo) ← señal fuerte de "cliente
  esperando"
- `dueAt` / `overdueAt` (SLA nativo de GHL), `assignedTo`, `tags`

Filtros/orden útiles: `sortBy=last_message_date&sort=desc`, `status`,
`lastMessageType`, `lastMessageDirection`, `startAfterDate` (paginación /
incremental).

**Implicación clave:** la clasificación Tier 1 (regex) corre sobre
`lastMessageBody` **sin gastar llamadas por-hilo ni tokens**. Solo se traen los
mensajes completos de los candidatos que valga la pena escalar a LLM.

## 4. Arquitectura del módulo

### 4.1 Ingesta (cron)
- Recorre `conversations/search` (`sort=last_message_date desc`), paginando con
  `startAfterDate` hasta una ventana de lookback (ej. últimos 45–60 días) o de
  forma incremental desde `lastMessageDate` de la última corrida.
- ~4.450 conversaciones ≈ 45 páginas de 100 en el backfill inicial; luego solo
  el delta diario. Reusa `mapWithConcurrency` + el manejo de rate-limit ya
  existente en `ghl-client`.

### 4.2 Clasificación de intención (2 tiers, barato → caro)
- **Tier 1 — regex (`INTENT_PATTERNS`):** sobre `lastMessageBody`. Marca "huele a
  venta" (consulta_precio, cotización, plan, "cuántos equipos", etc.). Descarta
  gratis el grueso (soporte, postventa, spam).
- **Tier 2 — LLM (solo candidatos ambiguos / de valor):** clasifica
  `{compra, soporte, postventa, spam, otro}` + urgencia. Reusa
  `resolveWorkingAIConfig`, caché `llm_analysis` (key = conversationId),
  concurrencia acotada (2) y batch cota-de-presupuesto como Forense. Para
  desambiguar puede traer los últimos N mensajes del hilo.

### 4.3 Dedupe contra oportunidades
Cruza `contactId` contra `deals`:
- **Sin oportunidad + intención de compra → "lead sin registrar"** (lo valioso).
- **Con oportunidad →** ya lo cubre Live Opp (se omite o se linkea).
- Boosters de urgencia: `unreadCount>0` + `lastMessageDirection=inbound` = cliente
  esperando; `overdueAt` vencido = SLA roto; sin `assignedTo` = huérfano.

### 4.4 Persistencia (nueva tabla)
`conversations` (o `conv_intel`): `tenantId`, `ghlConversationId` (unique con
tenant), `contactId`, `lastMessageSnippet`, `lastMessageDate`,
`lastMessageDirection`, `unreadCount`, `intentTier1` (bool), `intentLabel`
(LLM), `intentScore`, `hasOpportunity` (bool), `status`
(`nuevo|atendido|descartado`), `classifiedAt`, `syncedAt`. El veredicto LLM se
cachea además en `llm_analysis` (engine `radar`).

### 4.5 UI — `/dashboard/radar`
Tabla de **conversaciones con intención de compra sin oportunidad**, ordenada por
urgencia (unread + SLA vencido + antigüedad). Columnas: contacto · último mensaje
· hace cuánto · sin responder · señal de intención · dueño. Acciones 1-click:
- **Crear oportunidad en GHL** (nueva `AgentAction` `crear_oportunidad`, vía el
  executor AG-2 con nota `[AGENTE]`).
- Asignar vendedor · Ver conversación en GHL · Descartar (no es venta).

Filtro por vendedor desde el día 1 (reusa el patrón recién hecho en Live Opp).

### 4.6 Digest
Sección nueva: "Conversaciones sin registrar con intención de compra (N)" en el
digest matinal, por vendedor (o para no-asignadas, al pool/manager).

## 5. Costo LLM (estimado)
Como la clasificación corre sobre `lastMessageBody`, el gasto es marginal:
- Tier 1 (regex) filtra ~80–90% **gratis**.
- Backfill inicial: ~500–900 clasificaciones LLM cortas (~300–500 tokens input
  c/u) ⇒ ~0,3–0,5M tokens input. A precio deepseek-v3.2 (~US$0,27/M in) ⇒
  **centavos** por el backfill completo. Incremental: decenas por día.

## 6. Fases
- **R-1 (MVP, sin LLM):** ingesta + Tier 1 regex + dedupe contra `deals` + tabla
  "leads sin registrar" + botón crear oportunidad. Cero costo LLM, valor inmediato.
- **R-2:** Tier 2 LLM (desambiguación compra vs soporte/postventa) + urgencia +
  score; alimenta el digest.
- **R-3:** handoff al agente vendedor (auto-crear opp / auto-responder HSM) —
  converge con AG-4 (ver `agente-vendedor-arquitectura.md`).

## 7. Riesgos / consideraciones
- **Ruido soporte/postventa:** las muestras reales incluyen soporte y cotización
  de cámaras. Separar *compra* de *soporte/postventa* es el núcleo del valor —
  arranca con regex, se afina con LLM.
- **Conversaciones del bot (Alicia/Conversation AI):** último mensaje outbound del
  bot con `unreadCount>0` = el bot la sostiene pero ningún humano/opp la tomó;
  es señal de captura, no de descarte.
- **Rate limit GHL:** backfill de ~45 páginas — acotar concurrencia y cachear.
- **Plan/metering:** nuevo flag de motor en `plan-enforcement` + `usage_log`.
- **Migración:** tabla nueva (drizzle) aplicada ANTES del deploy.

## 8. Entregable de R-1 (para arrancar)
Migración + `src/lib/radar-engine.ts` (regex + dedupe) + `runRadarForTenant` en
`engine-runners` + cron `/api/cron/radar` + `/api/engines/radar` +
`/dashboard/radar` con la tabla y el botón "Crear oportunidad" + item en el nav.
