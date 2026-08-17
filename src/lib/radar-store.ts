/**
 * Radar Store (R-1) — ingesta + persistencia + lectura de conversaciones.
 *
 * Ingesta: pagina `conversations/search` (ordenado por último mensaje desc) hasta
 * una ventana de lookback, clasifica intención de compra (regex Tier-1), cruza
 * contra `deals` para el flag `hasOpportunity` y hace upsert. Solo persiste
 * candidatos accionables (intención de compra o mensajes sin leer) para que la
 * tabla SEA la cola del Radar. Ver docs/radar-conversaciones-propuesta.md.
 */

import { and, desc, eq, inArray, isNotNull, isNull, lt, notExists, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { deals, radarConversations } from '@/db/schema';
import {
  addContactTags,
  fetchContactById,
  fetchConversationByContact,
  fetchConversationsPage,
  fetchMessagesForContact,
  fetchUsersDetailed,
  mapWithConcurrency,
  removeContactTags,
  type GhlCredentials,
} from '@/lib/ghl-client';
import { assembleContactContext, renderContactContextForLLM } from '@/lib/contact-context';
import { classifyBuyIntent } from '@/lib/radar-engine';
import { classifyTenorLLM } from '@/lib/radar-llm';
import { reconcileTags } from '@/lib/tag-taxonomy';
import { resolveWorkingAIConfig } from '@/lib/ai-config';
import { toMessages } from '@/lib/types';
import type { LLMUsage } from '@/lib/llm';

/** Días hacia atrás que considera la ingesta (conversaciones más viejas se ignoran). */
const DEFAULT_LOOKBACK_DAYS = 60;
/**
 * Recencia de la actividad del CLIENTE: para ser candidato, el último mensaje
 * entrante debe estar dentro de esta ventana. El nurture automático "bombea"
 * `lastMessageDate`, así que la recencia real se mide por el inbound (feedback
 * Francisco jul-2026: aparecían conversaciones cuyo cliente escribió hace meses).
 */
const INBOUND_LOOKBACK_DAYS = 45;
/** Tope de páginas por corrida (cota dura; 100 conv/página). */
const DEFAULT_MAX_PAGES = 40;
/**
 * Presupuesto de tiempo por corrida. La secuencia de nurture deja miles de
 * conversaciones "recientes", así que el lookback no recorta y el escaneo puede
 * ser largo; este tope de wall-clock garantiza que la ingesta SIEMPRE retorne
 * (escribiendo lo que alcanzó) en vez de agotar el límite del serverless.
 */
const DEFAULT_BUDGET_MS = 45_000;

export interface RadarIngestResult {
  tenantId: string;
  pages: number;
  scanned: number; // conversaciones vistas
  candidates: number; // upserteadas (intención o sin leer)
  reachedLookback: boolean;
  timedOut: boolean; // true si cortó por presupuesto de tiempo
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

/**
 * Predicado SQL: el contacto de la fila NO tiene una oportunidad ABIERTA ni
 * GANADA en la BD (`deals`). Se evalúa EN VIVO contra `deals` en cada lectura,
 * en vez de confiar en el flag `has_opportunity` que la ingesta congela al
 * escribir la fila: la paginación de `conversations/search` no re-visita las
 * conversaciones viejas (el nurture "bombea" las recientes), así que un lead que
 * DESPUÉS obtuvo una oportunidad conservaba el flag viejo y seguía apareciendo
 * (bug ago-2026: "conversaciones que ya tienen oportunidad creada").
 *
 * Excluye `open` (las cubre Live Opp) y `won` (ya es cliente, no un lead). Deja
 * pasar contactos con solo `lost` (re-enganche) o sin deal — el valor del Radar;
 * el clasificador LLM (`esCliente`) los desempata.
 */
function noOpenOrWonOpportunity() {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(deals)
      .where(
        and(
          eq(deals.tenantId, radarConversations.tenantId),
          inArray(deals.status, ['open', 'won']),
          sql`(${deals.payload}::jsonb ->> 'contactId') = ${radarConversations.contactId}`,
        ),
      ),
  );
}

/** Ingesta del Radar para un tenant. */
export async function runRadarIngest(
  tenantId: string,
  creds: GhlCredentials,
  opts?: { maxPages?: number; lookbackDays?: number; budgetMs?: number },
): Promise<RadarIngestResult> {
  const maxPages = opts?.maxPages ?? DEFAULT_MAX_PAGES;
  const lookbackDays = opts?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const cutoff = Date.now() - lookbackDays * 86_400_000;
  const deadline = Date.now() + (opts?.budgetMs ?? DEFAULT_BUDGET_MS);

  const inboundCutoff = Date.now() - INBOUND_LOOKBACK_DAYS * 86_400_000;

  try {
    const [hasOppSet, users] = await Promise.all([
      openContactIds(tenantId),
      fetchUsersDetailed(creds),
    ]);
    const userMap: Record<string, string> = {};
    const internalEmails = new Set<string>();
    for (const u of users) {
      userMap[u.id] = u.name;
      if (u.email) internalEmails.add(u.email.toLowerCase());
    }

    let cursor: { startAfterDate?: string } | null = null;
    let pages = 0;
    let scanned = 0;
    let candidates = 0;
    let reachedLookback = false;
    let timedOut = false;

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

        // Excluir contactos internos (empleados/partners): email del dominio
        // propio o que coincide con un usuario de GHL (caso Francisca Martel).
        const email = (c.email ?? '').toLowerCase();
        if (email && (email.endsWith('@centralgps.cl') || internalEmails.has(email))) continue;

        // Recencia REAL del cliente: su último inbound (WhatsApp o, si el último
        // mensaje del hilo es entrante, esa fecha). Si el cliente no escribe
        // hace más de INBOUND_LOOKBACK_DAYS, no es una conversación viva.
        const lastInbound =
          c.lastInboundWhatsappMessageDate ??
          (c.lastMessageDirection === 'inbound' ? c.lastMessageDate : undefined);
        if (!lastInbound || lastInbound < inboundCutoff) continue;

        // Intención de compra SOLO si el último mensaje es del CLIENTE (inbound).
        // Los outbound automáticos (nurture/bot) traen lenguaje de venta de la
        // plantilla, no del cliente → serían falsos positivos (jul-2026: 146 de
        // 164 "compra" eran emails de nurture). El texto del bot se ignora.
        const cls = classifyBuyIntent(c.lastMessageBody);
        const isInbound = c.lastMessageDirection === 'inbound';
        const buyIntent = isInbound && cls.buyIntent;
        const signals = buyIntent ? cls.signals : [];
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
          lastInboundAt: new Date(lastInbound),
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
      if (Date.now() >= deadline) {
        timedOut = true;
        break;
      }
    } while (cursor && pages < maxPages);

    return { tenantId, pages, scanned, candidates, reachedLookback, timedOut };
  } catch (err) {
    return {
      tenantId,
      pages: 0,
      scanned: 0,
      candidates: 0,
      reachedLookback: false,
      timedOut: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Refresh dirigido del estado de los leads pendientes ─────────────────────

/** Concurrencia del refresh dirigido (1 llamada barata por lead). */
const REFRESH_CONCURRENCY = 6;
/** Tope de leads a refrescar por corrida (la cola es chica; cota de seguridad). */
const DEFAULT_REFRESH_MAX = 200;

export interface RadarRefreshResult {
  tenantId: string;
  checked: number; // leads consultados a GHL
  refreshed: number; // leads con estado actualizado
  gone: number; // conversaciones que GHL ya no devuelve (se dejan como están)
  error?: string;
}

/**
 * Refresca EN VIVO el estado LIVIANO (sin leer, último mensaje, inbound, señal de
 * compra) de los leads pendientes de la cola, con una llamada dirigida por lead
 * (`fetchConversationByContact`) — sin traer la historia ni recomputar el LLM.
 *
 * Resuelve el "Radar no actualiza nada": el barrido de paginación no re-visita
 * las conversaciones viejas (el nurture bombea las recientes), así que un lead ya
 * atendido seguía mostrando su "sin leer" viejo. NO recalcula el resumen comercial
 * (`llmResumen`): ese snapshot solo lo recompone `runRadarClassify` cuando llegan
 * mensajes nuevos (el `lastMessageAt` fresco de aquí es justo su gatillo). Tampoco
 * auto-descarta: un lead atendido queda visible con su estado fresco y sale de la
 * cola solo al descartar/convertir (decisión Francisco ago-2026).
 */
export async function runRadarRefreshPending(
  tenantId: string,
  creds: GhlCredentials,
  opts?: { max?: number },
): Promise<RadarRefreshResult> {
  const max = opts?.max ?? DEFAULT_REFRESH_MAX;
  try {
    const rows = await db
      .select({ id: radarConversations.id, contactId: radarConversations.contactId })
      .from(radarConversations)
      .where(
        and(
          eq(radarConversations.tenantId, tenantId),
          eq(radarConversations.status, 'nuevo'),
          isNotNull(radarConversations.contactId),
        ),
      )
      .orderBy(desc(radarConversations.lastInboundAt))
      .limit(max);

    let checked = 0;
    let refreshed = 0;
    let gone = 0;

    await mapWithConcurrency(rows, REFRESH_CONCURRENCY, async (row) => {
      if (!row.contactId) return;
      checked++;
      const conv = await fetchConversationByContact(creds, row.contactId).catch(() => null);
      if (!conv) {
        gone++;
        return; // GHL ya no la devuelve — dejamos la fila como está.
      }
      const lastMs = conv.lastMessageDate ?? 0;
      const lastInbound =
        conv.lastInboundWhatsappMessageDate ??
        (conv.lastMessageDirection === 'inbound' ? conv.lastMessageDate : undefined);
      // Señal de compra recomputada sobre el último mensaje fresco (mismo criterio
      // que la ingesta: solo cuenta si el último mensaje es del cliente).
      const cls = classifyBuyIntent(conv.lastMessageBody);
      const buyIntent = conv.lastMessageDirection === 'inbound' && cls.buyIntent;
      const unread = conv.unreadCount ?? 0;

      await db
        .update(radarConversations)
        .set({
          lastMessageSnippet: (conv.lastMessageBody ?? '').slice(0, 280) || null,
          lastMessageDirection: conv.lastMessageDirection ?? null,
          lastMessageAt: lastMs ? new Date(lastMs) : null,
          // `lastInboundAt` solo avanza: sin inbound fresco, conserva el previo.
          ...(lastInbound ? { lastInboundAt: new Date(lastInbound) } : {}),
          unreadCount: String(unread),
          buyIntent: buyIntent ? 'true' : 'false',
          intentSignals: JSON.stringify(buyIntent ? cls.signals : []),
          syncedAt: new Date(),
        })
        .where(eq(radarConversations.id, row.id));
      refreshed++;
    });

    return { tenantId, checked, refreshed, gone };
  } catch (err) {
    return {
      tenantId,
      checked: 0,
      refreshed: 0,
      gone: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Clasificación LLM del tenor + re-tag autónomo (R-2) ──────────────────

/** Cuántas conversaciones clasifica el LLM por corrida (drena de a poco). */
const CLASSIFY_BATCH_SIZE = 20;
/** Concurrencia LLM (mismo criterio que Forense: >2 revienta el gateway). */
const LLM_CONCURRENCY = 2;
/** Confianza mínima para aplicar cambios de tags AUTÓNOMAMENTE en GHL. */
const RETAG_MIN_CONFIDENCE = 0.6;

export interface RadarClassifyResult {
  tenantId: string;
  candidates: number;
  classified: number;
  /** Filas auto-descartadas del Radar (soporte/postventa/churn/interno/spam/frio). */
  dismissed: number;
  /** Contactos cuyos tags se corrigieron en GHL. */
  retagged: number;
  usage: LLMUsage;
  llmError?: string;
  error?: string;
}

/**
 * Clasifica con LLM el TENOR real de las conversaciones pendientes del Radar y
 * aplica las consecuencias de forma autónoma (decisión Francisco 2026-07-17):
 *
 *  - Solo `intencion-compra` permanece como lead del Radar; el resto (soporte,
 *    postventa, churn, interno, frio, spam) se auto-descarta de la cola.
 *  - Reconcilia los TAGS del contacto en GHL (`reconcileTags`): p.ej. un
 *    "prospecto" hablando de fallas de su equipo pasa a `cliente activo` +
 *    `soporte`. Deja bitácora en `tag_changes`.
 *
 * Re-clasifica una fila si llegaron mensajes nuevos (lastMessageAt avanzó).
 */
export async function runRadarClassify(
  tenantId: string,
  creds: GhlCredentials,
  opts?: { batchSize?: number },
): Promise<RadarClassifyResult> {
  const batchSize = opts?.batchSize ?? CLASSIFY_BATCH_SIZE;
  const usage: LLMUsage = { inputTokens: 0, outputTokens: 0 };
  try {
    const rows = await db
      .select()
      .from(radarConversations)
      .where(
        and(
          eq(radarConversations.tenantId, tenantId),
          eq(radarConversations.status, 'nuevo'),
          noOpenOrWonOpportunity(),
          or(
            isNull(radarConversations.llmClassifiedAt),
            lt(radarConversations.llmClassifiedAt, radarConversations.lastMessageAt),
            // Backfill: leads ya clasificados antes de existir el resumen comercial.
            isNull(radarConversations.llmResumen),
          ),
        ),
      )
      .orderBy(
        sql`${radarConversations.buyIntent} desc`,
        sql`${radarConversations.unreadCount}::int desc`,
      )
      .limit(batchSize);

    if (rows.length === 0) {
      return { tenantId, candidates: 0, classified: 0, dismissed: 0, retagged: 0, usage };
    }

    // Credenciales LLM verificadas ANTES del batch (lección BYOK jul-2026).
    const resolved = await resolveWorkingAIConfig(tenantId);
    if (!resolved.config) {
      return {
        tenantId,
        candidates: rows.length,
        classified: 0,
        dismissed: 0,
        retagged: 0,
        usage,
        llmError: resolved.error,
      };
    }
    const aiConfig = resolved.config;

    let classified = 0;
    let dismissed = 0;
    let retagged = 0;
    const errors: string[] = [];

    await mapWithConcurrency(rows, LLM_CONCURRENCY, async (row) => {
      if (!row.contactId) return;
      const messages = toMessages(
        await fetchMessagesForContact(creds, row.contactId).catch(() => []),
      );
      // Tercera capa (campos AI + notas del contacto) como contexto extra del
      // clasificador. Complementa la conversación, no la reemplaza.
      const contactContext = await assembleContactContext(creds, row.contactId).catch(() => null);
      const extraContext = contactContext ? renderContactContextForLLM(contactContext) : '';
      const tenor = await classifyTenorLLM(
        messages,
        aiConfig,
        (u) => {
          usage.inputTokens += u.inputTokens;
          usage.outputTokens += u.outputTokens;
        },
        (m) => errors.push(m),
        extraContext,
      );
      if (!tenor) return; // nunca cachear el fallback

      const isLead = tenor.tipo === 'intencion-compra' && !tenor.esCliente;

      // Re-tag autónomo en GHL (solo con confianza suficiente).
      let tagChanges: string | null = null;
      if (tenor.confianza >= RETAG_MIN_CONFIDENCE) {
        try {
          const contact = await fetchContactById(creds, row.contactId);
          if (contact) {
            const rec = reconcileTags(contact.tags ?? [], tenor);
            if (rec.add.length > 0 || rec.remove.length > 0) {
              if (rec.add.length > 0) await addContactTags(creds, row.contactId, rec.add);
              if (rec.remove.length > 0) await removeContactTags(creds, row.contactId, rec.remove);
              tagChanges = JSON.stringify({ add: rec.add, remove: rec.remove, motivo: rec.motivo });
              retagged++;
            }
          }
        } catch (err) {
          errors.push(`retag ${row.contactId}: ${err instanceof Error ? err.message : err}`);
        }
      }

      await db
        .update(radarConversations)
        .set({
          llmTipo: tenor.tipo,
          llmEsCliente: tenor.esCliente ? 'true' : 'false',
          llmConfianza: String(tenor.confianza),
          llmMotivo: tenor.motivo,
          llmResumen: tenor.resumen,
          llmClassifiedAt: new Date(),
          ...(tagChanges ? { tagChanges } : {}),
          // Solo la intención de compra de un NO-cliente es un lead del Radar;
          // el resto sale de la cola de forma autónoma.
          ...(isLead ? {} : { status: 'descartado' }),
        })
        .where(eq(radarConversations.id, row.id));
      classified++;
      if (!isLead) dismissed++;
    });

    return {
      tenantId,
      candidates: rows.length,
      classified,
      dismissed,
      retagged,
      usage,
      llmError: classified < rows.length ? errors[0] : undefined,
    };
  } catch (err) {
    return {
      tenantId,
      candidates: 0,
      classified: 0,
      dismissed: 0,
      retagged: 0,
      usage,
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
  /** Veredicto LLM (R-2), si ya fue clasificada. */
  llmTipo: string | null;
  llmMotivo: string | null;
  llmConfianza: number | null;
  /** Resumen comercial del hilo (servicio, nº de vehículos, etapa). */
  llmResumen: string | null;
}

/**
 * Leads del Radar: conversaciones con intención de compra o cliente esperando,
 * cuyo contacto NO tiene oportunidad abierta (la cubre Live Opp) ni ganada (ya
 * es cliente), y aún sin gestionar. Ordenadas por: intención → sin leer → recencia.
 */
export async function getRadarLeads(tenantId: string): Promise<RadarLead[]> {
  const rows = await db
    .select()
    .from(radarConversations)
    .where(
      and(
        eq(radarConversations.tenantId, tenantId),
        eq(radarConversations.status, 'nuevo'),
        noOpenOrWonOpportunity(),
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
    llmTipo: r.llmTipo,
    llmMotivo: r.llmMotivo,
    llmConfianza: r.llmConfianza != null ? Number(r.llmConfianza) : null,
    llmResumen: r.llmResumen,
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
        eq(radarConversations.status, 'nuevo'),
        noOpenOrWonOpportunity(),
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
