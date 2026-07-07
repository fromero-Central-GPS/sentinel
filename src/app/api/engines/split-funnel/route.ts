import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { enforceMotorAccess } from '@/lib/plan-enforcement';
import { getSyncedDeals, getSyncStatus, type SyncedDeal } from '@/lib/deal-sync';
import { classifyIntent, computeSplitFunnel, type ClassifiedDeal } from '@/lib/split-funnel';
import { toDeal, toMessages } from '@/lib/types';
import type { RawOpportunity, RawMessage } from '@/lib/ghl-client';

/**
 * Split the Funnel (Fase 4) — segmenta el funnel sincronizado por intención de
 * entrada (declarada vs creada) y compara conversión, ciclo y ticket.
 *
 * Es 100% cómputo sobre la BD ya sincronizada (`deals`/`deal_messages`): no
 * llama a GHL ni al LLM, así que corre en cada carga sin gastar rate limit ni
 * tokens. Requiere que el tenant haya sincronizado el funnel (igual que Won
 * Track lee el funnel completo).
 */

// ─── Mock ──────────────────────────────────────────────────────────────────

function buildMock() {
  const now = Date.now();
  const iso = (daysAgo: number) => new Date(now - daysAgo * 86400000).toISOString();

  const mk = (
    id: string,
    status: 'won' | 'lost' | 'open',
    value: number,
    createdDaysAgo: number,
    closedDaysAgo: number,
    firstBody: string,
    source?: string,
  ): SyncedDeal => ({
    deal: toDeal(
      {
        id,
        name: id,
        status,
        monetaryValue: value,
        pipelineName: 'Ventas 2026',
        pipelineStageName: status === 'won' ? 'Ganado' : status === 'lost' ? 'Perdido' : 'Consulta',
        createdAt: iso(createdDaysAgo),
        updatedAt: iso(closedDaysAgo),
        lastStageChangeAt: iso(closedDaysAgo),
        contactId: `c-${id}`,
        contact: { id: `c-${id}`, name: id },
        attributions: source ? [{ utmSessionSource: source, isFirst: true }] : undefined,
      } as RawOpportunity,
      status,
    ),
    messages: toMessages([
      {
        id: `${id}-m1`,
        direction: 'inbound',
        body: firstBody,
        messageType: 'TYPE_WHATSAPP',
        dateAdded: iso(createdDaysAgo),
      } as RawMessage,
    ]),
  });

  // Declarada: alta intención, convierte alto y rápido.
  const declarada: SyncedDeal[] = [
    mk('D1', 'won', 3_200_000, 12, 5, '¿Cuánto cuesta el GPS para mis 8 camiones?'),
    mk('D2', 'won', 1_800_000, 9, 4, 'Quiero cotizar el plan anual'),
    mk('D3', 'won', 2_400_000, 15, 6, 'Necesito una demo de la plataforma'),
    mk('D4', 'lost', 1_200_000, 20, 12, 'Me pasas el precio del servicio?'),
    mk('D5', 'open', 2_000_000, 6, 6, 'Quiero contratar, ¿cómo sigo?'),
  ];
  // Creada: baja intención (contenido/feria), convierte más bajo y lento.
  const creada: SyncedDeal[] = [
    mk('C1', 'won', 900_000, 40, 22, 'Descargué su ebook de gestión de flotas'),
    mk('C2', 'lost', 600_000, 35, 18, 'Vi su publicación en la feria de transporte'),
    mk('C3', 'lost', 750_000, 30, 20, 'Me llegó su newsletter, quería más información'),
    mk('C4', 'lost', 500_000, 28, 15, 'Hola, vi un webinar de ustedes'),
    mk('C5', 'open', 800_000, 10, 10, 'Descargué la guía, ¿me cuentan más?'),
  ];

  const all = [...declarada, ...creada];
  const classified: ClassifiedDeal[] = all.map(({ deal, messages }) => ({
    deal,
    intent: classifyIntent(deal, messages).intent,
  }));

  return {
    period: 'demo',
    dataSource: 'mock' as const,
    syncedAt: null as string | null,
    ...computeSplitFunnel(classified),
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const mode = new URL(request.url).searchParams.get('mode') ?? 'mock';
  if (mode === 'mock') return NextResponse.json(buildMock());

  // ─── Live ────────────────────────────────────────────────────────────
  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  if (!row?.ghlApiToken || !row?.ghlLocationId) {
    return NextResponse.json(
      {
        error: 'GHL not configured',
        hint: 'Ve a /settings y configura el API Token y Location ID de GHL.',
      },
      { status: 400 },
    );
  }

  // Split the Funnel es una vista analítica sobre el mismo funnel que Won Track;
  // se gobierna con el mismo gating de plan.
  const enforcement = await enforceMotorAccess('wonTrack');
  if (enforcement.blocked) return enforcement.response!;

  try {
    // Fuente única: la BD sincronizada (funnel completo won/lost/open). Sin sync
    // no hay nada que segmentar → devolvemos vacío con la pista de sincronizar.
    const [won, lost, open] = await Promise.all([
      getSyncedDeals(orgId, 'won'),
      getSyncedDeals(orgId, 'lost'),
      getSyncedDeals(orgId, 'open'),
    ]);
    const all = [...won, ...lost, ...open];

    if (all.length === 0) {
      return NextResponse.json({
        period: 'live',
        dataSource: 'sync',
        syncedAt: null,
        buckets: [],
        totalDeals: 0,
        classifiedPct: 0,
        insight: {
          conversionRatio: null,
          cycleGapDays: null,
          message: 'Sincroniza el funnel de GHL para segmentar la demanda por intención.',
        },
      });
    }

    const classified: ClassifiedDeal[] = all.map(({ deal, messages }) => ({
      deal,
      intent: classifyIntent(deal, messages).intent,
    }));

    const status = await getSyncStatus(orgId);

    return NextResponse.json({
      period: 'live',
      dataSource: 'sync',
      syncedAt: status.lastSyncedAt,
      ...computeSplitFunnel(classified),
    });
  } catch (err) {
    console.error('[Split the Funnel] live error:', err);
    return NextResponse.json({ error: 'Error al segmentar el funnel' }, { status: 502 });
  }
}
