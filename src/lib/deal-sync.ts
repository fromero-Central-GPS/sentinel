/**
 * Deal Sync — sincronización full-funnel de oportunidades GHL → BD (Fase 3).
 *
 * Motivación: GHL tiene cientos de oportunidades (776 lost en CentralGPS) pero
 * los motores solo re-muestreaban 15-20 por request. Este módulo copia TODO el
 * funnel a las tablas `deals`/`deal_messages` por páginas, y los motores leen
 * de la BD: análisis completo, sin rate limit y sin recomputar en cada carga.
 *
 * Diseño stateless para Vercel: cada invocación procesa UNA página (≤100 opps)
 * y devuelve el cursor; el cliente re-invoca hasta `done`. Los mensajes solo se
 * re-traen para deals nuevos o que cambiaron desde la última sincronización.
 */

import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { deals, dealMessages, appSettings } from '@/db/schema';
import {
  fetchOpportunitiesPage,
  fetchConversationIdByContact,
  fetchConversationMessages,
  mapWithConcurrency,
  type GhlCredentials,
  type OpportunityPageCursor,
  type OpportunityStatus,
  type RawOpportunity,
} from './ghl-client';
import { toDeal, toMessages, type CanonicalMessage, type Deal } from './types';

/** Estados que sincronizamos (el funnel completo que consumen los motores). */
export const SYNC_STATUSES: OpportunityStatus[] = ['won', 'lost', 'open'];

/** Concurrencia para traer conversaciones (mismo criterio que los motores). */
const MESSAGE_FETCH_CONCURRENCY = 5;
/** Máximo de mensajes por conversación (suficiente para el análisis). */
const MESSAGES_PER_CONVERSATION = 100;

export interface SyncCursor {
  /** Índice del status en SYNC_STATUSES que se está paginando. */
  statusIndex: number;
  page?: OpportunityPageCursor;
}

export interface SyncPageResult {
  status: OpportunityStatus;
  processed: number; // opps upserteadas en esta página
  messagesFetched: number; // deals cuya conversación se re-trajo
  totalForStatus: number; // total reportado por GHL para este status
  cursor: SyncCursor | null; // null = sync completo
  done: boolean;
}

function toDate(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Procesa UNA página del sync: upsert de deals + refresh de mensajes de los
 * deals nuevos/cambiados. Devuelve el cursor para la siguiente invocación.
 */
export async function syncDealsPage(
  tenantId: string,
  creds: GhlCredentials,
  cursor?: SyncCursor | null,
): Promise<SyncPageResult> {
  const statusIndex = cursor?.statusIndex ?? 0;
  const status = SYNC_STATUSES[statusIndex];
  const page = await fetchOpportunitiesPage(creds, status, cursor?.page);

  const canonical = page.opportunities.map((raw: RawOpportunity) => toDeal(raw, status));

  // Detectar qué deals cambiaron desde el último sync (para no re-traer
  // conversaciones que no se movieron — ahorra el 90% de las llamadas a GHL
  // en syncs incrementales).
  const ids = canonical.map((d) => d.id);
  const existing = ids.length
    ? await db
        .select({ ghlId: deals.ghlId, ghlUpdatedAt: deals.ghlUpdatedAt })
        .from(deals)
        .where(and(eq(deals.tenantId, tenantId), inArray(deals.ghlId, ids)))
    : [];
  const existingUpdated = new Map(existing.map((r) => [r.ghlId, r.ghlUpdatedAt?.getTime() ?? 0]));

  const changed = canonical.filter((d) => {
    const prev = existingUpdated.get(d.id);
    if (prev === undefined) return true; // nuevo
    const cur = toDate(d.updatedAt)?.getTime() ?? 0;
    return cur > prev;
  });

  // Upsert de deals (página completa, cambiados o no: payload siempre fresco).
  for (const d of canonical) {
    const values = {
      tenantId,
      ghlId: d.id,
      status: d.status,
      monetaryValue: String(d.monetaryValue ?? 0),
      contactName: d.contact.name,
      pipelineStageName: d.pipelineStageName || null,
      lostReasonId: d.lostReasonId ?? null,
      ghlCreatedAt: toDate(d.createdAt),
      lastStageChangeAt: toDate(d.lastStageChangeAt),
      ghlUpdatedAt: toDate(d.updatedAt),
      payload: JSON.stringify(d),
      syncedAt: new Date(),
    };
    await db
      .insert(deals)
      .values(values)
      .onConflictDoUpdate({ target: [deals.tenantId, deals.ghlId], set: values });
  }

  // Mensajes solo para deals nuevos/cambiados.
  let messagesFetched = 0;
  await mapWithConcurrency(changed, MESSAGE_FETCH_CONCURRENCY, async (d) => {
    const conversationId = await fetchConversationIdByContact(creds, d.contactId);
    const messages: CanonicalMessage[] = conversationId
      ? toMessages(
          await fetchConversationMessages(creds, conversationId, MESSAGES_PER_CONVERSATION),
        )
      : [];
    const lastMessageAt = messages.reduce<Date | null>((max, m) => {
      const t = toDate(m.dateAdded);
      return t && (!max || t > max) ? t : max;
    }, null);
    const values = {
      tenantId,
      dealGhlId: d.id,
      conversationId,
      payload: JSON.stringify(messages),
      messageCount: String(messages.length),
      lastMessageAt,
      syncedAt: new Date(),
    };
    await db
      .insert(dealMessages)
      .values(values)
      .onConflictDoUpdate({ target: [dealMessages.tenantId, dealMessages.dealGhlId], set: values });
    messagesFetched++;
  });

  // Cursor siguiente: misma status si hay más páginas; si no, siguiente status.
  let next: SyncCursor | null = null;
  if (page.next) {
    next = { statusIndex, page: page.next };
  } else if (statusIndex + 1 < SYNC_STATUSES.length) {
    next = { statusIndex: statusIndex + 1 };
  }

  return {
    status,
    processed: canonical.length,
    messagesFetched,
    totalForStatus: page.total,
    cursor: next,
    done: next === null,
  };
}

/**
 * Reconciliación de borrados: elimina los deals (y sus mensajes) que GHL ya no
 * devuelve. El sync es solo upsert, así que sin esto una oportunidad borrada en
 * GHL queda huérfana en la BD para siempre, alimentando digest/Live Opp/Forense
 * como un "fantasma" (bug jul-2026: leads inexistentes en el digest matinal).
 *
 * Criterio: tras un barrido COMPLETO del funnel, todo deal vivo quedó
 * re-upserteado con `synced_at ≥ runStartedAt`; los que conservan un `synced_at`
 * anterior no aparecieron en GHL y por tanto fueron borrados allá.
 *
 * IMPORTANTE: solo invocar cuando el barrido terminó (`done === true`). Un
 * barrido parcial (cortado por el presupuesto de páginas o un error) no vio todo
 * el funnel, y borraría deals vivos aún no re-sincronizados en esta corrida.
 */
export async function reconcileDeletedDeals(
  tenantId: string,
  runStartedAt: Date,
): Promise<number> {
  const stale = await db
    .select({ ghlId: deals.ghlId })
    .from(deals)
    .where(and(eq(deals.tenantId, tenantId), lt(deals.syncedAt, runStartedAt)));
  if (stale.length === 0) return 0;
  const ids = stale.map((r) => r.ghlId);
  await db
    .delete(dealMessages)
    .where(and(eq(dealMessages.tenantId, tenantId), inArray(dealMessages.dealGhlId, ids)));
  await db.delete(deals).where(and(eq(deals.tenantId, tenantId), inArray(deals.ghlId, ids)));
  return ids.length;
}

// ─── Lectura para los motores ────────────────────────────────────────────────

export interface SyncedDeal {
  deal: Deal;
  messages: CanonicalMessage[];
}

/** Estado del sync del tenant: cuántos deals hay por status y cuándo se sincronizó. */
export async function getSyncStatus(tenantId: string): Promise<{
  counts: Record<string, number>;
  lastSyncedAt: string | null;
}> {
  const rows = await db
    .select({
      status: deals.status,
      count: sql<number>`count(*)::int`,
      lastSyncedAt: sql<string | null>`max(${deals.syncedAt})`,
    })
    .from(deals)
    .where(eq(deals.tenantId, tenantId))
    .groupBy(deals.status);

  const counts: Record<string, number> = {};
  let lastSyncedAt: string | null = null;
  for (const r of rows) {
    counts[r.status] = r.count;
    if (r.lastSyncedAt && (!lastSyncedAt || r.lastSyncedAt > lastSyncedAt)) {
      lastSyncedAt = r.lastSyncedAt;
    }
  }
  return { counts, lastSyncedAt };
}

/**
 * Conteo de deals perdidos por `lostReasonId` (razón nativa de GHL). Base para
 * que el tenant etiquete cada id en Settings (P2). Ignora los que no tienen id.
 */
export async function getLostReasonCounts(tenantId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ lostReasonId: deals.lostReasonId, count: sql<number>`count(*)::int` })
    .from(deals)
    .where(and(eq(deals.tenantId, tenantId), eq(deals.status, 'lost')))
    .groupBy(deals.lostReasonId);
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.lostReasonId) out[r.lostReasonId] = r.count;
  }
  return out;
}

function parseDeal(payload: string): Deal | null {
  try {
    return JSON.parse(payload) as Deal;
  } catch {
    return null;
  }
}

function parseMessages(payload: string | undefined | null): CanonicalMessage[] {
  if (!payload) return [];
  try {
    const parsed = JSON.parse(payload);
    return Array.isArray(parsed) ? (parsed as CanonicalMessage[]) : [];
  } catch {
    return [];
  }
}

/**
 * Deals sincronizados de un status con sus mensajes, listos para los motores.
 * Devuelve [] si el tenant nunca sincronizó (los llamadores caen al modo legacy).
 *
 * Aplica aquí — única fuente de verdad para TODOS los motores (digest, Live Opp,
 * Forense, Won Track, Split the Funnel) — el filtro por el pipeline de ventas
 * configurado del tenant (`app_settings.ghl_sales_pipeline_id`). Los pipelines
 * post-venta (On Boarding, Up Sell…) contienen negocios ya ganados y con
 * `assignedTo` = dueño del contacto, así que no deben entrar a ningún análisis.
 * Si el tenant no configuró pipeline → sin filtro (comportamiento histórico).
 */
export async function getSyncedDeals(
  tenantId: string,
  status: OpportunityStatus,
): Promise<SyncedDeal[]> {
  const [settings] = await db
    .select({ salesPipelineId: appSettings.ghlSalesPipelineId })
    .from(appSettings)
    .where(eq(appSettings.tenantId, tenantId));
  const salesPipelineId = settings?.salesPipelineId ?? null;

  const dealRows = await db
    .select({ payload: deals.payload, ghlId: deals.ghlId })
    .from(deals)
    .where(and(eq(deals.tenantId, tenantId), eq(deals.status, status)));
  if (dealRows.length === 0) return [];

  const msgRows = await db
    .select({ dealGhlId: dealMessages.dealGhlId, payload: dealMessages.payload })
    .from(dealMessages)
    .where(eq(dealMessages.tenantId, tenantId));
  const msgByDeal = new Map(msgRows.map((r) => [r.dealGhlId, r.payload]));

  const out: SyncedDeal[] = [];
  for (const row of dealRows) {
    const deal = parseDeal(row.payload);
    if (!deal) continue;
    if (salesPipelineId && deal.pipelineId !== salesPipelineId) continue;
    out.push({ deal, messages: parseMessages(msgByDeal.get(row.ghlId)) });
  }
  return out;
}
