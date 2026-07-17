import { pgTable, text, timestamp, uuid, unique } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: text('clerk_id').notNull().unique(),
  email: text('email').notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkOrgId: text('clerk_org_id').notNull().unique(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userOrganizations = pgTable('user_organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const appSettings = pgTable('app_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull().unique(),
  // GHL credentials (AES-256-GCM encrypted)
  ghlApiToken: text('ghl_api_token'),
  ghlLocationId: text('ghl_location_id'),
  // IDs de custom fields de GHL por tenant (mapeo configurable para Won Track).
  // Si son null, el motor cae a sus defaults (ver DEFAULT_FIELD_MAP).
  ghlFieldPlan: text('ghl_field_plan'),
  ghlFieldEquipos: text('ghl_field_equipos'),
  // Pipeline de ventas del tenant (GHL). Los motores/digest solo consideran las
  // oportunidades de este pipeline; el resto (On Boarding, Up Sell, etc.) son
  // post-venta y no deben tratarse como negocios abiertos en riesgo. Si es null
  // → sin filtro (se consideran todas, comportamiento histórico).
  ghlSalesPipelineId: text('ghl_sales_pipeline_id'),
  // Mapa lostReasonId (GHL) → { name, reason? } serializado (JSON). GHL no expone
  // los nombres de las razones de pérdida por API; el tenant las etiqueta a mano
  // (P2). `reason` (código de taxonomía) habilita la calibración IA vs equipo.
  ghlLostReasonMap: text('ghl_lost_reason_map'),
  // Config de IA por tenant (tier). Si son null → default de plataforma + OIDC.
  aiType: text('ai_type'), // proveedor/tier: deepseek | anthropic | openai | custom
  aiModel: text('ai_model'), // slug del AI Gateway, ej: deepseek/deepseek-v3.2
  aiApiKey: text('ai_api_key'), // AI Gateway API key (BYOK), AES-256-GCM encrypted
  // Matriz de autonomía del agente (AG-3): JSON AgentAction → off|propose|auto.
  // null → default (todo 'propose': el cron propone, nada se ejecuta solo).
  agentAutonomy: text('agent_autonomy'),
  // Usuario GHL del agente (Valeria) — para firmar/detectar autoría y ownership.
  ghlAgentUserId: text('ghl_agent_user_id'),
  // Meta / WhatsApp Business credentials (AES-256-GCM encrypted)
  metaWabaId: text('meta_waba_id'),
  metaPhoneNumberId: text('meta_phone_number_id'),
  metaAccessToken: text('meta_access_token'),
  metaWebhookVerifyToken: text('meta_webhook_verify_token'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Billing ────────────────────────────────────────────────────────────

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(), // e.g. "Free", "Pro", "Enterprise"
  slug: text('slug').notNull().unique(), // e.g. "free", "pro", "enterprise"
  description: text('description'),
  priceMonthlyClp: text('price_monthly_clp'), // e.g. "0", "49900", "149900"
  features: text('features'), // JSON array of feature strings
  maxTenantUsers: text('max_tenant_users').default('5'),
  maxConversationsPerMonth: text('max_conversations_per_month').default('1000'),
  hasForense: text('has_forense').default('true'),
  hasLiveOpp: text('has_live_opp').default('true'),
  hasWonTrack: text('has_won_track').default('true'),
  isActive: text('is_active').default('true'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id')
    .notNull()
    .references(() => plans.id),
  status: text('status').notNull().default('active'), // active, cancelled, past_due, trialing
  currentPeriodStart: timestamp('current_period_start').defaultNow().notNull(),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelledAt: timestamp('cancelled_at'),
  trialEndsAt: timestamp('trial_ends_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Won Track thresholds (blueprint que alimenta Live Opp) ──────────────

export const wonTrackThresholds = pgTable('won_track_thresholds', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Clerk org id (mismo criterio de tenant que appSettings.tenantId)
  tenantId: text('tenant_id').notNull().unique(),
  // SuccessThresholds serializado (JSON). Lo consume Live Opp.
  thresholds: text('thresholds').notNull(),
  sampleSize: text('sample_size').notNull().default('0'),
  computedAt: timestamp('computed_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Usage tracking ─────────────────────────────────────────────────────

export const usageLog = pgTable('usage_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  periodKey: text('period_key').notNull(), // e.g. "2026-06"
  conversationsAnalyzed: text('conversations_analyzed').notNull().default('0'),
  forenseRuns: text('forense_runs').notNull().default('0'),
  liveOppRuns: text('live_opp_runs').notNull().default('0'),
  wonTrackRuns: text('won_track_runs').notNull().default('0'),
  // Tokens LLM reales consumidos (metering por tenant — Fase 3, IA por tier).
  llmTokensInput: text('llm_tokens_input').notNull().default('0'),
  llmTokensOutput: text('llm_tokens_output').notNull().default('0'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Deals sincronizados (full-funnel, Fase 3) ───────────────────────────
//
// Copia local de TODAS las oportunidades del tenant (won/lost/open) traídas por
// paginación desde GHL. Los motores leen de aquí en vez de re-muestrear 15-20
// opps por request: Won Track/Forense corren sobre el funnel completo y sin
// quemar rate limit de GHL en cada carga de pantalla.

export const deals = pgTable(
  'deals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** ID de la oportunidad en GHL. */
    ghlId: text('ghl_id').notNull(),
    status: text('status').notNull(), // open | won | lost | abandoned
    /** Valor en CLP como texto (consistente con el resto del schema). */
    monetaryValue: text('monetary_value').notNull().default('0'),
    contactName: text('contact_name'),
    pipelineStageName: text('pipeline_stage_name'),
    /** Razón de pérdida NATIVA de GHL (ground truth registrado por el equipo). */
    lostReasonId: text('lost_reason_id'),
    ghlCreatedAt: timestamp('ghl_created_at'),
    lastStageChangeAt: timestamp('last_stage_change_at'),
    ghlUpdatedAt: timestamp('ghl_updated_at'),
    /** Deal canónico serializado (JSON) — lo que consumen los motores. */
    payload: text('payload').notNull(),
    syncedAt: timestamp('synced_at').defaultNow().notNull(),
  },
  (t) => [unique('deals_tenant_ghl_unique').on(t.tenantId, t.ghlId)],
);

// Mensajes de la conversación de cada deal (CanonicalMessage[] serializado).
// Se reemplaza completo cuando el deal cambió desde la última sincronización.
export const dealMessages = pgTable(
  'deal_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    dealGhlId: text('deal_ghl_id').notNull(),
    conversationId: text('conversation_id'),
    payload: text('payload').notNull(), // CanonicalMessage[] JSON
    messageCount: text('message_count').notNull().default('0'),
    lastMessageAt: timestamp('last_message_at'),
    syncedAt: timestamp('synced_at').defaultNow().notNull(),
  },
  (t) => [unique('deal_messages_tenant_deal_unique').on(t.tenantId, t.dealGhlId)],
);

// Caché del último análisis LLM por tenant (para no re-quemar tokens en cada
// carga). engine: 'won_track' | 'forense'. key: 'playbook' o el opportunityId.
export const llmAnalysis = pgTable(
  'llm_analysis',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    engine: text('engine').notNull(),
    key: text('key').notNull(),
    payload: text('payload').notNull(), // JSON serializado
    model: text('model'),
    analyzedAt: timestamp('analyzed_at').defaultNow().notNull(),
  },
  (t) => [unique('llm_analysis_tenant_engine_key_unique').on(t.tenantId, t.engine, t.key)],
);

// ─── Outcome tracking (P2) ────────────────────────────────────────────────
//
// Registra cada vez que el equipo ACTÚA sobre una recomendación de Sentinel
// (acción 1-click en Forense: tag de reactivación o tarea). El outcome se
// resuelve después cruzando `dealGhlId` con el status actual del deal en
// `deals`: un deal que estaba perdido al actuar y hoy está won/open = recuperado.
// Es la base para medir el uplift del producto (argumento de venta).
// ─── Agente vendedor (AG-2) ───────────────────────────────────────────────
//
// Cola y bitácora de las acciones tipificadas del playbook. En AG-2 cada fila
// nace 'executed' (botón 1-click con humano aprobando); en AG-3 el cron del
// agente crea filas 'proposed' y ejecuta solas las que su nivel de autonomía
// permite. Ver docs/agente-vendedor-arquitectura.md §8.
export const agentActions = pgTable('agent_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  /** Oportunidad (ghlId) sobre la que se decidió la acción. */
  dealGhlId: text('deal_ghl_id').notNull(),
  contactId: text('contact_id'),
  /** AgentAction de la taxonomía (contactar_cliente, mover_a_frio, …). */
  action: text('action').notNull(),
  /** JSON: rationale, taskDueInDays, stage destino, texto del mensaje, etc. */
  params: text('params'),
  status: text('status').notNull().default('proposed'), // proposed|approved|executed|rejected|expired|failed
  decidedBy: text('decided_by').notNull().default('playbook'), // playbook | llm | humano
  /** Clerk userId del humano que aprobó/ejecutó (null cuando sea autónomo). */
  approvedBy: text('approved_by'),
  executedAt: timestamp('executed_at'),
  /** JSON: ids creados en GHL (taskId, noteId, messageId…). */
  ghlRefs: text('ghl_refs'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Historial de transiciones de ownership por deal (humano|agente|escalado|
// pausado). El estado operativo vive en GHL (Contact Owner + tag ai-pausado);
// esta tabla es auditoría y métricas. Vigente = última fila del deal.
export const dealOwnership = pgTable('deal_ownership', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  dealGhlId: text('deal_ghl_id').notNull(),
  owner: text('owner').notNull(), // humano | agente | escalado | pausado
  reason: text('reason'),
  /** Quién gatilló la transición (clerk userId, 'playbook', 'sync'…). */
  actor: text('actor'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Radar de Conversaciones (R-1) ────────────────────────────────────────
//
// Conversaciones de GHL clasificadas por intención de compra, para pescar las
// que NUNCA generaron oportunidad (el hueco que Live Opp, opportunity-driven, no
// cubre). Se puebla desde `conversations/search` (que trae `lastMessageBody` +
// `unreadCount` inline) y se cruza contra `deals` para el flag `hasOpportunity`.
// Ver docs/radar-conversaciones-propuesta.md.
export const radarConversations = pgTable(
  'radar_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** ID de la conversación en GHL. */
    ghlConversationId: text('ghl_conversation_id').notNull(),
    contactId: text('contact_id'),
    contactName: text('contact_name'),
    phone: text('phone'),
    email: text('email'),
    /** Snippet del último mensaje (para la UI; no guardamos el hilo completo). */
    lastMessageSnippet: text('last_message_snippet'),
    lastMessageDirection: text('last_message_direction'), // inbound | outbound
    lastMessageAt: timestamp('last_message_at'),
    lastInboundAt: timestamp('last_inbound_at'),
    /** Mensajes sin leer por el equipo (señal de "cliente esperando"). */
    unreadCount: text('unread_count').notNull().default('0'),
    /** Dueño (GHL userId) + nombre resuelto, si la conversación está asignada. */
    assignedTo: text('assigned_to'),
    ownerName: text('owner_name'),
    /** 'true' si el regex Tier-1 detectó intención de compra. */
    buyIntent: text('buy_intent').notNull().default('false'),
    /** Señales de intención detectadas (JSON string[]). */
    intentSignals: text('intent_signals'),
    /** 'true' si el contacto ya tiene una oportunidad ABIERTA (lo cubre Live Opp). */
    hasOpportunity: text('has_opportunity').notNull().default('false'),
    /** nuevo | descartado | convertido (el equipo lo gestiona desde la UI). */
    status: text('status').notNull().default('nuevo'),
    classifiedAt: timestamp('classified_at').defaultNow().notNull(),
    syncedAt: timestamp('synced_at').defaultNow().notNull(),
  },
  (t) => [unique('radar_conv_tenant_conv_unique').on(t.tenantId, t.ghlConversationId)],
);

export const recommendationEvents = pgTable('recommendation_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  /** Oportunidad (ghlId) sobre la que se actuó. */
  dealGhlId: text('deal_ghl_id').notNull(),
  contactId: text('contact_id'),
  engine: text('engine').notNull(), // forense | live_opp
  action: text('action').notNull(), // tag | task
  /** Razón de pérdida / ángulo de la recomendación aplicada. */
  reason: text('reason'),
  /** Status del deal al momento de actuar (para medir el cambio después). */
  statusAtEvent: text('status_at_event'),
  /** Valor del deal al momento de actuar (para uplift ponderado por $). */
  valueAtEvent: text('value_at_event'),
  payload: text('payload'), // JSON con detalle (tags aplicados, título, etc.)
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
