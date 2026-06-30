import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '@/lib/encryption';
import { enforceMotorAccess, incrementUsage } from '@/lib/plan-enforcement';
import { fetchOpportunities, fetchMessagesForContact } from '@/lib/ghl-client';
import type { RawOpportunity, RawMessage } from '@/lib/ghl-client';
import {
  analyzeWonDeal,
  generateWonTrackOutput,
  type GHLOpportunity,
  type GHLMessage,
  type WonTrackOutput,
} from '@/lib/won-track-engine';
import { saveTenantThresholds } from '@/lib/won-track-store';

/** Cuántos deals ganados muestreamos para extraer patrones de conversación (acota llamadas a GHL). */
const SAMPLE_SIZE = 20;

// ─── Mapeo CRM crudo → tipo del motor ────────────────────────────────────

function toEngineOpportunity(raw: RawOpportunity): GHLOpportunity {
  return {
    id: raw.id,
    name: raw.name ?? raw.contact?.name ?? 'Desconocido',
    monetaryValue: raw.monetaryValue ?? 0,
    pipelineName: raw.pipeline?.name ?? raw.pipelineName ?? '',
    pipelineStageName: raw.pipelineStage?.name ?? raw.pipelineStageName ?? '',
    status: raw.status ?? 'won',
    createdAt: raw.createdAt ?? raw.dateAdded ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? raw.lastStageChangeAt ?? new Date().toISOString(),
    contactId: raw.contact?.id ?? raw.contactId ?? raw.id,
    contact: {
      id: raw.contact?.id ?? raw.contactId ?? raw.id,
      name: raw.contact?.name ?? raw.name ?? 'Desconocido',
      companyName: raw.contact?.companyName ?? null,
      email: raw.contact?.email,
      phone: raw.contact?.phone,
      tags: raw.contact?.tags,
      score: raw.contact?.score,
    },
    customFields: raw.customFields,
    attributions: raw.attributions,
  };
}

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
    analyzeWonDeal(toEngineOpportunity(raw), mkMsgs(raw.id) as GHLMessage[]),
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

  const mode = new URL(request.url).searchParams.get('mode') ?? 'mock';

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

  try {
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

    const deals = await Promise.all(
      sample.map(async (raw) => {
        const opp = toEngineOpportunity(raw);
        const messages = (await fetchMessagesForContact(creds, opp.contactId)) as GHLMessage[];
        return analyzeWonDeal(opp, messages);
      }),
    );

    const output = generateWonTrackOutput(
      deals,
      deals.map((d) => d.features),
      deals.map((d) => d.patterns),
    );

    // Persistir el blueprint → lo consume Live Opp.
    await saveTenantThresholds(orgId, output.thresholds);
    await incrementUsage('wonTrack', deals.length);

    const avgTicket = Math.round(
      wonRaw.reduce((s, o) => s + (o.monetaryValue ?? 0), 0) / wonRaw.length,
    );
    const total = wonRaw.length + lostRaw.length;

    return NextResponse.json(buildResponse(output, wonRaw.length, total, avgTicket, 'live'));
  } catch (err) {
    console.error('[Won Track] live error:', err);
    return NextResponse.json({ error: 'Error al consultar GHL' }, { status: 502 });
  }
}
