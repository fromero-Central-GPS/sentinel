import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '@/lib/encryption';
import {
  enforceMotorAccess,
  enforceConversationLimit,
  incrementUsage,
} from '@/lib/plan-enforcement';
import { analyzeLiveOpportunity, getDefaultThresholds } from '@/lib/live-opp-engine';
import type { LiveOppAnalysis, OpenOpportunity } from '@/lib/live-opp-engine';
import type { CanonicalMessage, Deal } from '@/lib/types';
import {
  decidePlaybookAction,
  ACTION_LABELS,
  EXECUTABLE_ACTIONS,
} from '@/lib/playbook-engine';
import {
  fetchOpportunities,
  fetchMessagesForContact,
  fetchStageMap,
  fetchUsers,
  mapWithConcurrency,
} from '@/lib/ghl-client';
import { toDeal, toMessages } from '@/lib/types';
import { DEFAULT_FIELD_MAP } from '@/lib/won-track-engine';
import { getTenantThresholds } from '@/lib/won-track-store';

/**
 * Decisión del playbook (AG-1/AG-2) en la forma que consume la UI: acción
 * tipificada + rationale + lo que el botón de ejecución necesita postear.
 */
function playbookForUi(deal: Deal, messages: CanonicalMessage[], analysis: LiveOppAnalysis) {
  const d = decidePlaybookAction(deal, messages, analysis);
  return {
    action: d.action,
    label: ACTION_LABELS[d.action],
    rationale: d.rationale,
    taskDueInDays: d.taskDueInDays,
    executable: EXECUTABLE_ACTIONS.includes(d.action),
    contactId: deal.contactId,
    pipelineId: deal.pipelineId,
  };
}

export async function GET(request: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'mock';

  if (mode === 'mock') {
    const thresholds = getDefaultThresholds();
    const analyzedOpps: Array<{
      analysis: ReturnType<typeof analyzeLiveOpportunity>;
      opportunityName: string;
      comentarios: string;
      owner: string | null;
      createdAt: string;
      playbook: ReturnType<typeof playbookForUi>;
    }> = [];

    const mockOpps: OpenOpportunity[] = [
      {
        id: '1',
        name: 'Constructora Beta',
        monetaryValue: 1200000,
        pipelineName: 'Ventas 2026',
        pipelineStageName: 'Negociación',
        status: 'open',
        createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 15 * 86400000).toISOString(),
        contactId: 'c1',
        contact: { id: 'c1', name: 'Constructora Beta' },
        assignedTo: 'user1',
      },
      {
        id: '2',
        name: 'Transportes Gamma',
        monetaryValue: 800000,
        pipelineName: 'Ventas 2026',
        pipelineStageName: 'Propuesta Enviada',
        status: 'open',
        createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 8 * 86400000).toISOString(),
        contactId: 'c2',
        contact: { id: 'c2', name: 'Transportes Gamma' },
        assignedTo: 'user2',
      },
      {
        id: '3',
        name: 'Logística Delta',
        monetaryValue: 2500000,
        pipelineName: 'Ventas 2026',
        pipelineStageName: 'Demo agendada',
        status: 'open',
        createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        contactId: 'c3',
        contact: { id: 'c3', name: 'Logística Delta' },
      },
    ];

    const mockDeal: Record<string, string> = {
      '1': 'Plan Pro Anual x3 | Constructora Beta',
      '2': 'Plan Lite Mensual x1 | Transportes Gamma',
      '3': 'Plan Super Anual x8 | Logística Delta',
    };
    const mockComentarios: Record<string, string> = {
      '1': 'Necesito rastrear 3 camiones, plan anual con reportes',
      '2': 'Cotizar GPS para 1 vehículo, plan mensual',
      '3': 'Flota de 8 vehículos, requiere integración con su ERP',
    };
    const mockOwners: Record<string, string> = {
      user1: 'Berna Correa',
      user2: 'Diego Riquelme',
    };

    for (const opp of mockOpps) {
      const messages = [
        {
          id: 'm1',
          direction: 'inbound' as const,
          body: 'Hola me interesa',
          dateAdded: opp.updatedAt,
          messageType: 'TYPE_WHATSAPP',
        },
      ];
      const analysis = analyzeLiveOpportunity(opp, messages, thresholds);
      if (analysis.riskLevel !== 'none') {
        analyzedOpps.push({
          analysis,
          opportunityName: mockDeal[opp.id] ?? opp.name,
          comentarios: mockComentarios[opp.id] ?? '',
          owner: opp.assignedTo ? (mockOwners[opp.assignedTo] ?? null) : null,
          createdAt: opp.createdAt,
          playbook: playbookForUi(opp, messages, analysis),
        });
      }
    }

    const mappedOpps = analyzedOpps
      .map(({ analysis: a, opportunityName, comentarios, owner, createdAt, playbook }) => ({
        id: a.opportunityId,
        name: a.contactName || a.opportunityId,
        opportunityName,
        comentarios,
        owner,
        stage: a.stage,
        daysSinceActivity: a.totalMessages === 0 ? null : a.daysSinceLastContact,
        daysOpen: a.daysOpen,
        isPastBenchmark: a.isPastBenchmark,
        createdAt,
        riskScore: a.overallRiskScore,
        value: a.value,
        riskLevel: a.riskLevel,
        recommendedActions: a.recommendedActions.slice(0, 3),
        playbook,
      }))
      .sort((a, b) => b.riskScore - a.riskScore);

    return NextResponse.json({
      totalAtRisk: mappedOpps.length,
      totalValue: mappedOpps.reduce((acc, curr) => acc + curr.value, 0),
      opportunities: mappedOpps,
    });
  }

  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  if (!row?.ghlApiToken || !row?.ghlLocationId) {
    return NextResponse.json(
      {
        error: 'GHL not configured',
        hint: 'Ve a /settings y configura el API Token y Location ID de GHL.',
        _meta: { mode: 'live', configured: false },
      },
      { status: 400 },
    );
  }

  // Plan enforcement
  const enforcement = await enforceMotorAccess('liveOpp');
  if (enforcement.blocked) return enforcement.response!;

  const creds = { token: decrypt(row.ghlApiToken), locationId: row.ghlLocationId };

  // Fetch open opportunities
  let rawOpps;
  try {
    rawOpps = await fetchOpportunities(creds, 'open', 50);
  } catch (err) {
    return NextResponse.json({ error: `GHL error: ${String(err)}` }, { status: 502 });
  }

  // Restringe al pipeline de ventas configurado del tenant: los pipelines
  // post-venta (On Boarding, Up Sell…) son negocios ya ganados, no
  // oportunidades abiertas. Sin pipeline configurado → sin filtro.
  if (row.ghlSalesPipelineId) {
    rawOpps = rawOpps.filter((o) => o.pipelineId === row.ghlSalesPipelineId);
  }

  // Check conversation limit before processing
  const limitCheck = await enforceConversationLimit(rawOpps.length);
  if (limitCheck.blocked) return limitCheck.response!;

  // Usa el blueprint real del tenant (Won Track); si nunca corrió, cae a defaults.
  // En paralelo: mapa de etapas (id→nombre) y de usuarios (id→nombre) para
  // enriquecer cada oportunidad — GHL search no trae ni el nombre de etapa ni el dueño.
  const [thresholds, stageMap, userMap] = await Promise.all([
    getTenantThresholds(orgId).then((t) => t ?? getDefaultThresholds()),
    fetchStageMap(creds),
    fetchUsers(creds),
  ]);

  // Preparamos los deals y traemos los mensajes de TODAS las opps en paralelo.
  // (Antes solo se pedían las top-25 por valor → el resto quedaba sin actividad y
  // mostraba el centinela "999d".)
  const deals = rawOpps.map((opp) => {
    const deal = toDeal(opp, 'open');
    // Resuelve el nombre de la etapa (search solo trae el id).
    deal.pipelineStageName = stageMap[opp.pipelineStageId ?? ''] ?? deal.pipelineStageName;
    return { opp, deal };
  });

  // Concurrencia acotada para no reventar el rate limit de GHL (429).
  const messagesByOpp = await mapWithConcurrency(deals, 5, ({ deal }) =>
    deal.contactId
      ? fetchMessagesForContact(creds, deal.contactId)
          .then(toMessages)
          .catch(() => [])
      : Promise.resolve([]),
  );

  const analyzedOpps: Array<{
    analysis: ReturnType<typeof analyzeLiveOpportunity>;
    opportunityName: string;
    comentarios: string;
    owner: string | null;
    createdAt: string;
    playbook: ReturnType<typeof playbookForUi>;
  }> = [];

  deals.forEach(({ opp, deal }, i) => {
    const analysis = analyzeLiveOpportunity(deal, messagesByOpp[i], thresholds);
    if (analysis.riskLevel !== 'none') {
      // "Comentarios" (custom field de la oportunidad) = lo que el cliente cotiza.
      const comentarios =
        opp.customFields
          ?.find((f) => f.id === DEFAULT_FIELD_MAP.comentarios)
          ?.fieldValueString?.trim() || '';
      analyzedOpps.push({
        analysis,
        // Nombre del deal (ej "Plan Lite Anual x2 | TRANSMACO"), aparte del contacto.
        opportunityName: opp.name ?? deal.name ?? '',
        comentarios,
        owner: deal.assignedTo ? (userMap[deal.assignedTo] ?? null) : null,
        createdAt: deal.createdAt,
        playbook: playbookForUi(deal, messagesByOpp[i], analysis),
      });
    }
  });

  const mappedOpps = analyzedOpps
    .map(({ analysis: a, opportunityName, comentarios, owner, createdAt, playbook }) => ({
      id: a.opportunityId,
      name: a.contactName || a.opportunityId,
      opportunityName,
      comentarios,
      owner,
      stage: a.stage,
      // null = sin conversación (no mostrar el centinela 999d).
      daysSinceActivity: a.totalMessages === 0 ? null : a.daysSinceLastContact,
      daysOpen: a.daysOpen,
      isPastBenchmark: a.isPastBenchmark,
      createdAt,
      riskScore: a.overallRiskScore,
      value: a.value,
      riskLevel: a.riskLevel,
      recommendedActions: a.recommendedActions.slice(0, 3),
      playbook,
    }))
    .sort((a, b) => b.riskScore - a.riskScore);

  // Track usage
  await incrementUsage('liveOpp', rawOpps.length);

  return NextResponse.json({
    totalAtRisk: mappedOpps.length,
    totalValue: mappedOpps.reduce((acc, curr) => acc + curr.value, 0),
    opportunities: mappedOpps,
    _meta: { mode: 'live' },
  });
}
