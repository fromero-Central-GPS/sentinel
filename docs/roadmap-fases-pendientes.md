# Sentinel — Fases pendientes (handoff para nuevo workspace)

> Actualizado: 2026-07-06. Contexto completo para retomar el roadmap en un
> workspace nuevo. Todo lo listado como "hecho" está mergeado en `main` y
> deployado en prod (`sentinel.supersonics.cl`).

## Estado actual (qué ya está en producción)

- **Fase 0–2 + P0 completas**: capa canónica (`Deal`/`taxonomy`), motores
  Forense/Won Track/Live Opp, LLM on-demand con caché (`llm_analysis`),
  **sync full-funnel GHL→BD** (tablas `deals`/`deal_messages`, 1.693 deals del
  tenant real: 776 lost / 200 won / 717 open), `lostReasonId` nativo capturado,
  transcript con limpieza de emails y truncación head+tail, `timeToClose` por
  `lastStageChangeAt`.
- **IA por tier gestionada por plataforma** (PR #4): el tenant elige plan
  (free/pro/enterprise) y nunca ve modelos ni keys. `TIER_MODELS` en
  `src/lib/ai-config.ts` (free/pro = deepseek-v3.2, enterprise =
  claude-sonnet-4.6; override por env `SENTINEL_LLM_MODEL_<TIER>`). Credencial
  única de plataforma (OIDC del proyecto Vercel); atribución de gasto por
  tenant vía `providerOptions.gateway {user, tags tenant:/tier:/engine:}` —
  visible en el dashboard del AI Gateway. Metering de tokens reales en
  `usage_log` (`llm_tokens_input/output`).
- **AI Gateway con créditos pagos** (confirmado 2026-07-06): ya no aplica el
  rate limit del free tier. El batch IA de Forense corre con concurrencia 2 y
  procesa 25 deals por click (top valor sin caché).
- Live Opp muestra etapa, dueño, comentarios, "sin actividad" y "abierta hace
  X días" con fecha de creación (ámbar si supera la mediana de cierre).

### Runbook de deploy (importante)

- Prod se deploya **por CLI**, no por push: `vercel deploy --prod` (workspace
  linkeado con `vercel link --yes --project sentinel --scope central-gps`).
- BD prod: Neon `damp-grass-14438063` (org Vercel `org-solitary-king-78984175`).
  Migraciones a mano: `psql "$(neonctl connection-string --project-id
  damp-grass-14438063 --org-id org-solitary-king-78984175)" -f drizzle/000X.sql`
  (psql en `/opt/homebrew/opt/libpq/bin/psql`). Última aplicada: 0007.
- Flujo git: branch → PR a `main` → merge → `vercel deploy --prod`.
- **Textos**: español neutro/chileno. Nada de voseo rioplatense
  (`apretá/revisá/podés/tenés/acá`). Grep antes de mergear UI.

### Tarea operativa inmediata (5 min, con los créditos ya cargados)

Correr "✨ Correr análisis IA" en Forense repetidas veces (25 deals por click,
~30 clicks) hasta cubrir las 776 perdidas — o mejor: implementar P1-1 (cron) y
que se complete solo. Verificar consumo en `usage_log` y en el dashboard del
AI Gateway (filtrar por tag `tenant:`).

---

## P1 — Activación (siguiente prioridad)

Objetivo: pasar de "dashboard que hay que mirar" a "herramienta que empuja la
venta". El usuario confirmó **WhatsApp** como canal para los vendedores.

> **Estado (branch `p1-activacion`): implementado, falta deploy + config.**
> tsc/lint/tests verdes. Pendiente antes de que sirva en prod:
> 1. Setear env **`CRON_SECRET`** en Vercel (los cron de `vercel.json` se auto-
>    autentican con `Authorization: Bearer $CRON_SECRET`; sin la env, los
>    endpoints quedan abiertos — `verifyCronAuth` es fail-open solo en dev).
> 2. Deploy: `vercel deploy --prod` (los crons se registran al deployar).
> 3. Para el digest real: aprobar una **plantilla Meta** con UNA variable de
>    cuerpo y setear `WHATSAPP_DIGEST_TEMPLATE` (+ `WHATSAPP_DIGEST_LANG`, def.
>    `es`); cargar credenciales Meta por tenant en Settings; y que los usuarios
>    de GHL tengan **teléfono** (el digest agrupa por `assignedTo` y envía al
>    `phone` del vendedor). Sin todo eso el cron hace **dry-run** y devuelve el
>    preview de cada mensaje en el JSON de respuesta.
> Qué se construyó:
> - `src/lib/engine-runners.ts`: núcleo por-tenant sin Clerk (`listGhlTenants`,
>   `runSyncForTenant`, `runForenseForTenant`, `runWonTrackForTenant`,
>   `verifyCronAuth`). Respeta ping-antes-de-batch, concurrencia 2 y cachear
>   solo diagnósticos reales del LLM.
> - Crons `GET /api/cron/{sync,forense,won-track,digest}` (`vercel.json`):
>   sync c/2h, forense 06:00 UTC, won-track lun 07:00 UTC, digest 12:00 UTC
>   (~08:00 Santiago). `maxDuration=300`.
> - `src/lib/whatsapp.ts` + `src/lib/digest.ts`: digest por vendedor desde el
>   funnel sincronizado (Live Opp crítico/alto), envío por Meta Cloud API.
> - 1-click Forense→GHL: `POST /api/actions/ghl` (`tag`/`task`) + botones en la
>   fila expandida de la tabla de Forense. La ola se segmenta por razón
>   (`reactivation_wave_YYYYMMDD` + `reactivation_<angle>`).
> - Helpers de escritura en `ghl-client.ts`: `addContactTags`,
>   `createContactTask`, `fetchUsersDetailed` (con teléfono).

### P1-1 Corridas programadas (cron)

- Vercel crons (`vercel.json` o `crons` en config): Forense nocturno (con
  `?llm=true`, el batch de 25 va drenando las pendientes), Won Track semanal,
  Live Opp cada 1–2 horas (solo cómputo, sin LLM).
- Los endpoints existentes (`/api/engines/*`) usan `auth()` de Clerk → para
  cron se necesita una entrada server-side por tenant: iterar tenants con GHL
  configurado (`app_settings`) y ejecutar la lógica con el `orgId` explícito
  (refactor: extraer el core de cada ruta a una función `runForense(orgId,...)`
  invocable sin request de Clerk, protegida por `CRON_SECRET`).
- El sync de deals también debe correr en cron (incremental: ya solo re-trae
  conversaciones de deals cambiados).

### P1-2 Digest WhatsApp matinal

- Credenciales Meta/WhatsApp Business ya están por tenant en `app_settings`
  (`meta_waba_id`, `meta_phone_number_id`, `meta_access_token`, encriptadas).
- Contenido: para cada vendedor (assignedTo → `fetchUsers`): deals críticos de
  Live Opp (cliente esperando respuesta, valor en riesgo), 2–3 acciones
  recomendadas. Un mensaje por vendedor, plantilla corta.
- Requiere plantilla aprobada en Meta (business-initiated) o ventana de 24h.
  Empezar simple: template genérico con variables.
- Cron diario ~8:00 America/Santiago.

### P1-3 Acción 1-click Forense → GHL

- En la tabla de Forense (recuperables): botón "Crear tarea en GHL" y/o
  "Agregar a ola de reactivación" (tag al contacto, patrón que el equipo ya
  usa: `reactivation_wave1_20260622`).
- API GHL: POST /contacts/{id}/tags y POST tasks (el MCP `prod-ghl-cmp-mcp`
  tiene `ghl_create_task`/`ghl_create_note` como referencia de payloads; en el
  producto va vía `ghl-client.ts` con el token del tenant).
- Segmentar la ola por razón de pérdida (precio → oferta; sin_seguimiento →
  disculpa + humano; competidor → comparativa).

## P2 — Inteligencia comparativa

> **Estado (branch `p2-comparativa`): 4 de 4 ítems implementados.** tsc/lint/
> 42 tests verdes. **Antes de deploy: aplicar migraciones 0008 y 0009** a la BD
> de prod (`ghl_lost_reason_map` + tabla `recommendation_events`) con el psql
> del runbook. Luego `vercel deploy --prod`.

- ✅ **Lift de factores won vs lost** — `src/lib/comparative.ts`
  (`computeFactorLift`, suavizado Laplace). Won Track carga los perdidos
  sincronizados, extrae los mismos factores (`analyzeWonDeal`) y muestra tabla
  "Qué separa ganar de perder" (ganados% vs perdidos% + lift). Cae a la lista de
  frecuencia si aún no hay perdidos. Tests en `comparative.test.ts`.
- ✅ **Benchmarks segmentados** por tamaño de flota — `computeSegmentedThresholds`
  (muestra mín. 3 por segmento); tarjeta "Benchmarks por tamaño de flota" en Won
  Track. (Pendiente menor: que Live Opp elija el threshold del segmento del deal
  en vez del global.)
- ✅ **Etiquetas de `lostReasonId`** — `src/lib/lost-reasons.ts` +
  `/api/settings/lost-reasons` + sección en Settings para nombrar cada id y
  mapearlo a taxonomía. Forense muestra "Razón registrada por el equipo" y el
  **% de acuerdo IA ↔ equipo** (`computeCalibration`, sobre deals con ambas
  señales). No hay endpoint público de GHL para los nombres → etiquetado manual.
- ✅ **Outcome tracking** — migración 0009 + tabla `recommendation_events` +
  `src/lib/outcomes.ts`. Cada acción 1-click de Forense registra un evento; el
  outcome se resuelve cruzando el deal con su status ACTUAL en `deals` (perdido
  al actuar y hoy won/open = recuperado). Forense muestra la tarjeta "Impacto de
  las recomendaciones" con la tasa de recuperación. (Extensión futura: registrar
  también cuando se MUESTRA una recomendación de Live Opp, no solo al actuar.)

## Fase 4 — Split the Funnel (Refine Labs)

- Segmentar pipeline por intención de entrada: **Declarada** (demo/precio/
  contacto directo) vs **Creada** (contenido/feria/ads fríos), usando
  `attributions` + primer mensaje de la conversación.
- Comparar por bucket: conversion rate, lead-to-win, sales velocity, ticket.
- Vista nueva en dashboard. Depende de datos ya sincronizados; hacer después
  de P2 (reusa el mismo motor de cohortes).

## Menores

- Rename plan "Free" → "Lite" (seed `scripts/seed-plans.ts` + UI; `TIER_MODELS`
  ya soporta ambos slugs).
- Lint: 30 errores `any` preexistentes en `settings/page.tsx` y otros.
- `deal_messages` guarda máx 100 mensajes por conversación (`MESSAGES_PER_
  CONVERSATION`); si hay conversaciones más largas, paginar hacia atrás.
- Live Opp aún lee de GHL directo (50 opps); migrarlo a la BD sincronizada
  como Forense/Won Track cuando el sync corra por cron (P1-1).

## Lecciones aprendidas (no repetir)

- **Nunca cachear el fallback como si fuera output del LLM** (bug jul-2026:
  75 filas de regex etiquetadas deepseek).
- **Verificar credenciales con `pingLLM` antes de un batch** y mostrar el
  error real en la UI (`llmError` en `_meta`).
- `isLLMEnabled()` no debe exigir `VERCEL_OIDC_TOKEN` en env: en runtime de
  Vercel el OIDC se resuelve por request context (`VERCEL=1` habilita).
- Batches LLM con `mapWithConcurrency` (2–3), nunca N en paralelo.
- `updatedAt` de GHL se contamina con ediciones masivas; usar
  `lastStageChangeAt` para fechas de cierre.
