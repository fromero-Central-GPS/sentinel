import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '@/lib/encryption';
import { enforceMotorAccess, incrementUsage } from '@/lib/plan-enforcement';
import { fetchOpportunities, fetchMessagesForContact, mapWithConcurrency } from '@/lib/ghl-client';
import type { RawOpportunity, RawMessage } from '@/lib/ghl-client';
import { toDeal, toMessages } from '@/lib/types';
import {
  analyzeWonDeal,
  generateWonTrackOutput,
  type WonTrackOutput,
  type CustomFieldMap,
} from '@/lib/won-track-engine';
import { summarizeWinningPlaybookLLM } from '@/lib/wontrack-llm';
import { resolveWorkingAIConfig } from '@/lib/ai-config';
import { getLlmAnalysis, saveLlmAnalysis } from '@/lib/llm-store';
import { saveTenantThresholds } from '@/lib/won-track-store';
import { getSyncedDeals, getSyncStatus } from '@/lib/deal-sync';
import {
  computeFactorLift,
  computeSegmentedThresholds,
  type FactorLift,
  type SegmentThresholds,
} from '@/lib/comparative';

/** Cuántos deals ganados muestreamos para extraer patrones de conversación (acota llamadas a GHL). */
const SAMPLE_SIZE = 20;

// ─── Construcción de la respuesta para el frontend ────────────────────────

/** Convierte el conteo de deals por canal en un porcentaje de la muestra (lo que el UI rotula "win rate"). */
function channelDistributionPct(
  channelCounts: Record<string, number>,
  sampleSize: number,
): Record<string, number> {
  if (sampleSize <= 0) return {};
  const out: Record<string, number> = {};
  for (const [channel, count] of Object.entries(channelCounts)) {
    out[channel] = Math.round((count / sampleSize) * 1000) / 10; // 1 decimal
  }
  return out;
}

function buildResponse(
  output: WonTrackOutput,
  wonCount: number,
  total: number,
  avgTicket: number,
  period: string,
) {
  const { thresholds } = output;
  const conversionRate = total > 0 ? wonCount / total : 0;

  // Agrega los factores de éxito (códigos de taxonomía) entre los deals analizados.
  const factorCounts: Record<string, number> = {};
  for (const deal of output.deals) {
    for (const f of deal.factors) factorCounts[f] = (factorCounts[f] ?? 0) + 1;
  }
  const topWinFactors = Object.entries(factorCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([factor, count]) => ({ factor, count }));

  const alerts: { type: string; message: string }[] = [];
  if (thresholds.sampleSize === 0) {
    alerts.push({
      type: 'info',
      message: 'No hay deals ganados con conversaciones analizables todavía.',
    });
  }
  if (conversionRate > 0 && conversionRate < 0.2) {
    alerts.push({
      type: 'warning',
      message: `Tasa de conversión ${(conversionRate * 100).toFixed(1)}% bajo el umbral de 20%.`,
    });
  }

  return {
    period,
    won: wonCount,
    total,
    conversionRate,
    avgTicket,
    avgCycleDays: thresholds.avgTimeToClose,
    alerts,
    successThresholds: thresholds,
    businessFeatures: {
      topChannel: thresholds.topChannel,
      channelWinRates: channelDistributionPct(thresholds.channelWinRates, thresholds.sampleSize),
    },
    communicationPatterns: {
      avgResponseMinutes: thresholds.avgResponseMinutes,
      medianResponseMinutes: thresholds.medianResponseMinutes,
      avgInboundRatio: thresholds.avgInboundRatio,
    },
    topWinFactors,
    playbookSummary: output.playbookSummary ?? null,
    playbookAnalyzedAt: output.playbookAnalyzedAt ?? null,
  };
}

// ─── Mock ──────────────────────────────────────────────────────────────────

function buildMock() {
  const now = Date.now();
  const mkOpp = (id: string, name: string, value: number, daysToClose: number): RawOpportunity => ({
    id,
    name,
    status: 'won',
    monetaryValue: value,
    pipelineName: 'Ventas 2026',
    pipelineStageName: 'Ganado',
    createdAt: new Date(now - (daysToClose + 2) * 86400000).toISOString(),
    updatedAt: new Date(now - 2 * 86400000).toISOString(),
    contactId: `c-${id}`,
    contact: { id: `c-${id}`, name, companyName: name, tags: ['2 a 9 vehículos'] },
    attributions: [{ utmSessionSource: 'whatsapp', isFirst: true }],
  });

  const wonOpps = [
    mkOpp('W1', 'Transportes Alfa', 4_500_000, 6),
    mkOpp('W2', 'Constructora Beta', 1_200_000, 18),
    mkOpp('W3', 'Logística Delta', 2_500_000, 3),
  ];

  const mkMsgs = (oppId: string): RawMessage[] => [
    {
      id: `${oppId}-m1`,
      direction: 'inbound',
      body: 'Hola, me interesa el servicio para mi flota',
      messageType: 'TYPE_WHATSAPP',
      dateAdded: new Date(now - 10 * 86400000).toISOString(),
    },
    {
      id: `${oppId}-m2`,
      direction: 'outbound',
      body: 'Perfecto, te envío la cotización adjunta',
      messageType: 'TYPE_WHATSAPP',
      dateAdded: new Date(now - 10 * 86400000 + 20 * 60000).toISOString(),
    },
    {
      id: `${oppId}-m3`,
      direction: 'inbound',
      body: 'Gracias, perfecto. Te hago la transferencia hoy',
      messageType: 'TYPE_WHATSAPP',
      dateAdded: new Date(now - 9 * 86400000).toISOString(),
    },
  ];

  const deals = wonOpps.map((raw) =>
    analyzeWonDeal(toDeal(raw, 'won'), toMessages(mkMsgs(raw.id))),
  );
  const output = generateWonTrackOutput(
    deals,
    deals.map((d) => d.features),
    deals.map((d) => d.patterns),
  );

  const avgTicket = Math.round(
    wonOpps.reduce((s, o) => s + (o.monetaryValue ?? 0), 0) / wonOpps.length,
  );
  // total = ganados + perdidos simulados para una tasa de conversión realista
  return buildResponse(output, wonOpps.length, wonOpps.length + 9, avgTicket, 'demo');
}

// ─── Handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const mode = params.get('mode') ?? 'mock';
  // El LLM (playbook) solo corre on-demand (?llm=true) para no quemar tokens en
  // cada refresh de la pantalla.
  const useLLM = params.get('llm') === 'true';

  if (mode === 'mock') {
    return NextResponse.json(buildMock());
  }

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

  const enforcement = await enforceMotorAccess('wonTrack');
  if (enforcement.blocked) return enforcement.response!;

  const creds = { token: decrypt(row.ghlApiToken), locationId: row.ghlLocationId };
  // Mapeo de custom fields del tenant; null en BD → el motor usa sus defaults.
  const fieldMap: CustomFieldMap = {
    plan: row.ghlFieldPlan ?? undefined,
    equipos: row.ghlFieldEquipos ?? undefined,
  };

  try {
    // ─── Fuente de datos: BD sincronizada (funnel completo) o GHL directo ──
    //
    // Con sync: analizamos TODOS los deals ganados (no una muestra top-20 por
    // valor, que sesgaba los benchmarks hacia los deals grandes) y sin gastar
    // rate limit de GHL. Sin sync: comportamiento legacy (muestra directa).
    const synced = await getSyncedDeals(orgId, 'won');
    const usingSync = synced.length > 0;

    let deals;
    let wonCount: number;
    let lostCount: number;
    let avgTicket: number;
    let syncedAt: string | null = null;
    // P2 — inteligencia comparativa: qué separa ganar de perder + benchmarks por
    // segmento. Solo se computa con sync (necesita el funnel completo won+lost).
    let factorLift: FactorLift[] = [];
    let segments: SegmentThresholds[] = [];

    if (usingSync) {
      const status = await getSyncStatus(orgId);
      syncedAt = status.lastSyncedAt;
      wonCount = status.counts['won'] ?? synced.length;
      lostCount = status.counts['lost'] ?? 0;
      deals = synced.map(({ deal, messages }) => analyzeWonDeal(deal, messages, fieldMap));
      avgTicket = Math.round(
        synced.reduce((s, { deal }) => s + (deal.monetaryValue ?? 0), 0) / synced.length,
      );

      // Lift: mismos factores extraídos sobre los perdidos, para contrastar.
      const syncedLost = await getSyncedDeals(orgId, 'lost');
      const lostDeals = syncedLost.map(({ deal, messages }) =>
        analyzeWonDeal(deal, messages, fieldMap),
      );
      factorLift = computeFactorLift(
        deals.map((d) => d.factors),
        lostDeals.map((d) => d.factors),
      );
      segments = computeSegmentedThresholds(
        deals.map((d) => ({ features: d.features, patterns: d.patterns })),
      );
    } else {
      // Conteos para la tasa de conversión (baratos: solo metadatos).
      const [wonRaw, lostRaw] = await Promise.all([
        fetchOpportunities(creds, 'won', 100),
        fetchOpportunities(creds, 'lost', 100),
      ]);

      if (wonRaw.length === 0) {
        const empty = generateWonTrackOutput([], [], []);
        await saveTenantThresholds(orgId, empty.thresholds);
        return NextResponse.json(buildResponse(empty, 0, lostRaw.length, 0, 'live'));
      }

      // Muestra los deals de mayor valor para extraer patrones de conversación.
      const sample = [...wonRaw]
        .sort((a, b) => (b.monetaryValue ?? 0) - (a.monetaryValue ?? 0))
        .slice(0, SAMPLE_SIZE);

      // Concurrencia acotada para no reventar el rate limit de GHL (429).
      deals = await mapWithConcurrency(sample, 5, async (raw) => {
        const opp = toDeal(raw, 'won');
        const messages = toMessages(await fetchMessagesForContact(creds, opp.contactId));
        return analyzeWonDeal(opp, messages, fieldMap);
      });
      wonCount = wonRaw.length;
      lostCount = lostRaw.length;
      avgTicket = Math.round(
        wonRaw.reduce((s, o) => s + (o.monetaryValue ?? 0), 0) / wonRaw.length,
      );
    }

    const output = generateWonTrackOutput(
      deals,
      deals.map((d) => d.features),
      deals.map((d) => d.patterns),
    );

    // Persistir el blueprint → lo consume Live Opp.
    await saveTenantThresholds(orgId, output.thresholds);

    // Fase 2: narrativa playbook por LLM.
    let llmError: string | undefined;
    let llmFallback = false;
    const llmUsage = { inputTokens: 0, outputTokens: 0 };
    if (useLLM) {
      // On-demand: verifica credenciales (BYOK → plataforma), corre el LLM y
      // guarda el resultado. Si nada funciona, reporta el error real a la UI.
      const resolved = await resolveWorkingAIConfig(orgId);
      llmFallback = resolved.usedFallback;
      if (!resolved.config) {
        llmError = resolved.error ?? 'Sin credenciales de AI Gateway.';
      } else {
        const summary = await summarizeWinningPlaybookLLM(output, resolved.config, (u) => {
          llmUsage.inputTokens += u.inputTokens;
          llmUsage.outputTokens += u.outputTokens;
        });
        if (summary) {
          output.playbookSummary = summary;
          output.playbookAnalyzedAt = new Date().toISOString();
          await saveLlmAnalysis(orgId, 'won_track', 'playbook', summary, resolved.config.model);
        } else {
          llmError = 'El LLM no devolvió un playbook (ver logs).';
        }
      }
      if (!output.playbookSummary) {
        // Sin playbook nuevo: mostrar el último cacheado para no dejar la UI vacía.
        const cached = await getLlmAnalysis<string>(orgId, 'won_track');
        const pb = cached.find((r) => r.key === 'playbook');
        if (pb) {
          output.playbookSummary = pb.payload;
          output.playbookAnalyzedAt = pb.analyzedAt;
        }
      }
    } else {
      // Carga normal: muestra el último playbook guardado (0 tokens).
      const cached = await getLlmAnalysis<string>(orgId, 'won_track');
      const pb = cached.find((r) => r.key === 'playbook');
      if (pb) {
        output.playbookSummary = pb.payload;
        output.playbookAnalyzedAt = pb.analyzedAt;
      }
    }

    await incrementUsage('wonTrack', deals.length, llmUsage);

    return NextResponse.json({
      ...buildResponse(output, wonCount, wonCount + lostCount, avgTicket, 'live'),
      dataSource: usingSync ? 'sync' : 'direct',
      syncedAt,
      factorLift,
      segments,
      llmError: llmError ?? null,
      llmFallback,
    });
  } catch (err) {
    console.error('[Won Track] live error:', err);
    return NextResponse.json({ error: 'Error al consultar GHL' }, { status: 502 });
  }
}
