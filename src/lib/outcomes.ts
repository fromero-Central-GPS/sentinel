/**
 * Outcome tracking (P2) — mide el uplift de actuar sobre las recomendaciones.
 *
 * Cada acción 1-click sobre una recomendación (tag de reactivación / tarea)
 * registra un evento. Después cruzamos el evento con el status ACTUAL del deal
 * en `deals`: un deal que estaba perdido cuando actuamos y hoy está won/open =
 * recuperado. Eso da la métrica que vende Sentinel: "de los deals perdidos donde
 * el equipo aplicó la recomendación, X% se recuperó".
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { recommendationEvents, deals } from '@/db/schema';

export interface RecordEventInput {
  tenantId: string;
  dealGhlId: string;
  contactId?: string;
  engine: 'forense' | 'live_opp';
  action: 'tag' | 'task';
  reason?: string;
  statusAtEvent?: string;
  valueAtEvent?: number;
  payload?: unknown;
}

/** Registra un evento de recomendación aplicada. Nunca lanza (best-effort). */
export async function recordRecommendationEvent(input: RecordEventInput): Promise<void> {
  try {
    await db.insert(recommendationEvents).values({
      tenantId: input.tenantId,
      dealGhlId: input.dealGhlId,
      contactId: input.contactId ?? null,
      engine: input.engine,
      action: input.action,
      reason: input.reason ?? null,
      statusAtEvent: input.statusAtEvent ?? null,
      valueAtEvent: input.valueAtEvent != null ? String(input.valueAtEvent) : null,
      payload: input.payload != null ? JSON.stringify(input.payload) : null,
    });
  } catch (err) {
    // Outcome tracking no debe romper la acción principal (tag/task en GHL).
    console.error('[outcomes] no se pudo registrar el evento:', err);
  }
}

export interface OutcomeStats {
  /** Eventos totales registrados. */
  events: number;
  /** Deals distintos sobre los que se actuó. */
  dealsActed: number;
  /** De los que estaban perdidos al actuar: cuántos hoy están won u open. */
  recovered: number;
  /** Subconjunto de `recovered` que hoy está won (recuperación completa). */
  recoveredWon: number;
  /** recovered / (deals perdidos al actuar). */
  recoveryRate: number;
  /** Valor CLP de los deals recuperados (por su valor al momento de actuar). */
  valueRecovered: number;
}

const EMPTY: OutcomeStats = {
  events: 0,
  dealsActed: 0,
  recovered: 0,
  recoveredWon: 0,
  recoveryRate: 0,
  valueRecovered: 0,
};

/**
 * Estadísticas de outcome del tenant. Cruza los eventos con el status actual de
 * cada deal en `deals` (fuente de verdad tras el último sync).
 */
export async function getOutcomeStats(tenantId: string): Promise<OutcomeStats> {
  const events = await db
    .select({
      dealGhlId: recommendationEvents.dealGhlId,
      statusAtEvent: recommendationEvents.statusAtEvent,
      valueAtEvent: recommendationEvents.valueAtEvent,
    })
    .from(recommendationEvents)
    .where(eq(recommendationEvents.tenantId, tenantId));

  if (events.length === 0) return EMPTY;

  // Status actual de los deals referenciados.
  const dealIds = [...new Set(events.map((e) => e.dealGhlId))];
  const dealRows = await db
    .select({ ghlId: deals.ghlId, status: deals.status })
    .from(deals)
    .where(and(eq(deals.tenantId, tenantId), inArray(deals.ghlId, dealIds)));
  const currentStatus = new Map(dealRows.map((r) => [r.ghlId, r.status]));

  // Un evento por deal (el primero) para no contar dos veces el mismo deal:
  // nos importa el estado inicial y el desenlace, no cuántas veces se actuó.
  const firstByDeal = new Map<string, { statusAtEvent: string | null; valueAtEvent: string | null }>();
  for (const e of events) {
    if (!firstByDeal.has(e.dealGhlId)) {
      firstByDeal.set(e.dealGhlId, {
        statusAtEvent: e.statusAtEvent,
        valueAtEvent: e.valueAtEvent,
      });
    }
  }

  let lostAtEvent = 0;
  let recovered = 0;
  let recoveredWon = 0;
  let valueRecovered = 0;
  for (const [dealGhlId, ev] of firstByDeal) {
    if (ev.statusAtEvent !== 'lost') continue;
    lostAtEvent++;
    const now = currentStatus.get(dealGhlId);
    if (now === 'won' || now === 'open') {
      recovered++;
      if (now === 'won') recoveredWon++;
      valueRecovered += Number(ev.valueAtEvent ?? 0) || 0;
    }
  }

  return {
    events: events.length,
    dealsActed: firstByDeal.size,
    recovered,
    recoveredWon,
    recoveryRate: lostAtEvent > 0 ? recovered / lostAtEvent : 0,
    valueRecovered,
  };
}
