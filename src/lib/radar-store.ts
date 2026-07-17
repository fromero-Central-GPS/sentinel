/**
 * Radar Store (R-1) — ingesta + persistencia + lectura de conversaciones.
 *
 * Ingesta: pagina `conversations/search` (ordenado por último mensaje desc) hasta
 * una ventana de lookback, clasifica intención de compra (regex Tier-1), cruza
 * contra `deals` para el flag `hasOpportunity` y hace upsert. Solo persiste
 * candidatos accionables (intención de compra o mensajes sin leer) para que la
 * tabla SEA la cola del Radar. Ver docs/radar-conversaciones-propuesta.md.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { deals, radarConversations } from '@/db/schema';
import {
  fetchConversationsPage,
  fetchUsers,
  type GhlCredentials,
} from '@/lib/ghl-client';
import { classifyBuyIntent } from '@/lib/radar-engine';

/** Días hacia atrás que considera la ingesta (conversaciones más viejas se ignoran). */
const DEFAULT_LOOKBACK_DAYS = 60;
/** Tope de páginas por corrida (cota de tiempo serverless; 100 conv/página). */
const DEFAULT_MAX_PAGES = 60;

export interface RadarIngestResult {
  tenantId: string;
  pages: number;
  scanned: number; // conversaciones vistas
  candidates: number; // upserteadas (intención o sin leer)
  reachedLookback: boolean;
  error?: string;
}

/** contactIds del tenant con una oportunidad ABIERTA (para el dedupe). */
async function openContactIds(tenantId: string): Promise<Set<string>> {
  const rows = await db
    .select({ payload: deals.payload })
    .from(deals)
    .where(and(eq(deals.tenantId, tenantId), eq(deals.status, 'open')));
  const set = new Set<string>();
  for (const r of rows) {
    try {
      const d = JSON.parse(r.payload) as { contactId?: string };
      if (d.contactId) set.add(d.contactId);
    } catch {
      // payload corrupto: sáltalo.
    }
  }
  return set;
}

/** Ingesta del Radar para un tenant. */
export async function runRadarIngest(
  tenantId: string,
  creds: GhlCredentials,
  opts?: { maxPages?: number; lookbackDays?: number },
): Promise<RadarIngestResult> {
  const maxPages = opts?.maxPages ?? DEFAULT_MAX_PAGES;
  const lookbackDays = opts?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const cutoff = Date.now() - lookbackDays * 86_400_000;

  try {
    const [hasOppSet, userMap] = await Promise.all([openContactIds(tenantId), fetchUsers(creds)]);

    let cursor: { startAfterDate?: string } | null = null;
    let pages = 0;
    let scanned = 0;
    let candidates = 0;
    let reachedLookback = false;

    outer: do {
      const page = await fetchConversationsPage(creds, cursor ?? undefined);
      pages++;
      for (const c of page.conversations) {
        const lastMs = c.lastMessageDate ?? 0;
        // Ordenadas desc por fecha: al cruzar el lookback, todo lo demás es más
        // viejo → cortamos.
        if (lastMs && lastMs < cutoff) {
          reachedLookback = true;
          break outer;
        }
        scanned++;

        const { buyIntent, signals } = classifyBuyIntent(c.lastMessageBody);
        const unread = c.unreadCount ?? 0;
        // Solo guardamos lo accionable: intención de compra o cliente esperando.
        if (!buyIntent && unread <= 0) continue;

        const hasOpp = c.contactId ? hasOppSet.has(c.contactId) : false;
        const values = {
          tenantId,
          ghlConversationId: c.id,
          contactId: c.contactId ?? null,
          contactName: c.contactName ?? c.fullName ?? null,
          phone: c.phone ?? null,
          email: c.email ?? null,
          lastMessageSnippet: (c.lastMessageBody ?? '').slice(0, 280) || null,
          lastMessageDirection: c.lastMessageDirection ?? null,
          lastMessageAt: lastMs ? new Date(lastMs) : null,
          lastInboundAt: c.lastInboundWhatsappMessageDate
            ? new Date(c.lastInboundWhatsappMessageDate)
            : null,
          unreadCount: String(unread),
          assignedTo: c.assignedTo ?? null,
          ownerName: c.assignedTo ? (userMap[c.assignedTo] ?? null) : null,
          buyIntent: buyIntent ? 'true' : 'false',
          intentSignals: JSON.stringify(signals),
          hasOpportunity: hasOpp ? 'true' : 'false',
          syncedAt: new Date(),
        };
        await db
          .insert(radarConversations)
          .values(values)
          .onConflictDoUpdate({
            target: [radarConversations.tenantId, radarConversations.ghlConversationId],
            // NO tocar `status` ni `classifiedAt`: preserva la gestión humana
            // (descartado/convertido) entre corridas.
            set: {
              contactId: values.contactId,
              contactName: values.contactName,
              phone: values.phone,
              email: values.email,
              lastMessageSnippet: values.lastMessageSnippet,
              lastMessageDirection: values.lastMessageDirection,
              lastMessageAt: values.lastMessageAt,
              lastInboundAt: values.lastInboundAt,
              unreadCount: values.unreadCount,
              assignedTo: values.assignedTo,
              ownerName: values.ownerName,
              buyIntent: values.buyIntent,
              intentSignals: values.intentSignals,
              hasOpportunity: values.hasOpportunity,
              syncedAt: values.syncedAt,
            },
          });
        candidates++;
      }
      cursor = page.next;
    } while (cursor && pages < maxPages);

    return { tenantId, pages, scanned, candidates, reachedLookback };
  } catch (err) {
    return {
      tenantId,
      pages: 0,
      scanned: 0,
      candidates: 0,
      reachedLookback: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Lectura para la UI ────────────────────────────────────────────────────

export interface RadarLead {
  id: string;
  conversationId: string;
  contactId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  lastMessageSnippet: string | null;
  lastMessageDirection: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  ownerName: string | null;
  buyIntent: boolean;
  intentSignals: string[];
  status: string;
}

/**
 * Leads del Radar: conversaciones con intención de compra o cliente esperando,
 * SIN oportunidad abierta (lo que Live Opp no cubre) y aún sin gestionar.
 * Ordenadas por: intención de compra → sin leer → recencia.
 */
export async function getRadarLeads(tenantId: string): Promise<RadarLead[]> {
  const rows = await db
    .select()
    .from(radarConversations)
    .where(
      and(
        eq(radarConversations.tenantId, tenantId),
        eq(radarConversations.hasOpportunity, 'false'),
        eq(radarConversations.status, 'nuevo'),
      ),
    );

  const leads = rows.map((r) => ({
    id: r.id,
    conversationId: r.ghlConversationId,
    contactId: r.contactId,
    contactName: r.contactName,
    phone: r.phone,
    email: r.email,
    lastMessageSnippet: r.lastMessageSnippet,
    lastMessageDirection: r.lastMessageDirection,
    lastMessageAt: r.lastMessageAt ? r.lastMessageAt.toISOString() : null,
    unreadCount: Number(r.unreadCount ?? '0'),
    ownerName: r.ownerName,
    buyIntent: r.buyIntent === 'true',
    intentSignals: safeParseArray(r.intentSignals),
    status: r.status,
  }));

  leads.sort((a, b) => {
    if (a.buyIntent !== b.buyIntent) return a.buyIntent ? -1 : 1;
    if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
    return (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '');
  });
  return leads;
}

/** Marca el estado de gestión de un lead (descartado | convertido | nuevo). */
export async function setRadarStatus(
  tenantId: string,
  conversationId: string,
  status: 'nuevo' | 'descartado' | 'convertido',
): Promise<void> {
  await db
    .update(radarConversations)
    .set({ status })
    .where(
      and(
        eq(radarConversations.tenantId, tenantId),
        eq(radarConversations.ghlConversationId, conversationId),
      ),
    );
}

/** Conteo de leads pendientes (para KPIs / badge). */
export async function getRadarLeadCount(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(radarConversations)
    .where(
      and(
        eq(radarConversations.tenantId, tenantId),
        eq(radarConversations.hasOpportunity, 'false'),
        eq(radarConversations.status, 'nuevo'),
      ),
    );
  return row?.n ?? 0;
}

function safeParseArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const p = JSON.parse(s);
    return Array.isArray(p) ? (p as string[]) : [];
  } catch {
    return [];
  }
}
