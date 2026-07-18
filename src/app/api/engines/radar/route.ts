import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { decrypt } from '@/lib/encryption';
import {
  createOpportunity,
  fetchFirstStage,
  fetchLocationDomain,
  type GhlCredentials,
} from '@/lib/ghl-client';
import {
  getRadarLeads,
  runRadarClassify,
  runRadarIngest,
  setRadarStatus,
} from '@/lib/radar-store';

/**
 * Radar — API del módulo de conversaciones con intención de compra sin
 * oportunidad. GET lee la cola (de la BD); POST refresca la ingesta o gestiona un
 * lead (crear oportunidad / descartar). Ver docs/radar-conversaciones-propuesta.md.
 */

export const maxDuration = 300;

async function tenantCreds(
  orgId: string,
): Promise<{ creds: GhlCredentials; salesPipelineId: string | null } | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  if (!row?.ghlApiToken || !row?.ghlLocationId) return null;
  return {
    creds: { token: decrypt(row.ghlApiToken), locationId: row.ghlLocationId },
    salesPipelineId: row.ghlSalesPipelineId ?? null,
  };
}

/**
 * Base del CRM del tenant para deep-links a conversaciones. Cachea el dominio
 * whitelabel por tenant (24h) para no llamar a GHL en cada carga de la vista.
 */
const crmBaseCache = new Map<string, { base: string; at: number }>();
const CRM_BASE_TTL_MS = 24 * 3600 * 1000;

async function resolveCrmBase(orgId: string): Promise<{ base: string; locationId: string } | null> {
  const t = await tenantCreds(orgId);
  if (!t) return null;
  const cached = crmBaseCache.get(orgId);
  if (cached && Date.now() - cached.at < CRM_BASE_TTL_MS) {
    return { base: cached.base, locationId: t.creds.locationId };
  }
  const domain = await fetchLocationDomain(t.creds).catch(() => null);
  const base = `https://${domain || 'app.gohighlevel.com'}`;
  crmBaseCache.set(orgId, { base, at: Date.now() });
  return { base, locationId: t.creds.locationId };
}

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [leads, crm] = await Promise.all([getRadarLeads(orgId), resolveCrmBase(orgId)]);
  return NextResponse.json({
    leads,
    total: leads.length,
    // La UI arma: `${ghlBase}/v2/location/${ghlLocationId}/conversations/all/${conversationId}`
    ghlBase: crm?.base ?? null,
    ghlLocationId: crm?.locationId ?? null,
  });
}

export async function POST(request: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    conversationId?: string;
    contactId?: string;
    contactName?: string;
  };
  const action = body.action;

  const t = await tenantCreds(orgId);
  if (!t) {
    return NextResponse.json(
      { error: 'GHL no configurado', hint: 'Configura GHL en Settings.' },
      { status: 400 },
    );
  }

  // Refrescar la ingesta on-demand (además del cron). Acotada en páginas y
  // tiempo para responder rápido: escanea lo más reciente y clasifica un batch
  // corto con LLM. El cron hace el barrido y drenaje profundos.
  if (action === 'refresh') {
    const result = await runRadarIngest(orgId, t.creds, { maxPages: 15, budgetMs: 40_000 });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 502 });
    const classify = await runRadarClassify(orgId, t.creds, { batchSize: 10 });
    const [leads, crm] = await Promise.all([getRadarLeads(orgId), resolveCrmBase(orgId)]);
    return NextResponse.json({
      ok: true,
      result,
      classify,
      leads,
      total: leads.length,
      ghlBase: crm?.base ?? null,
      ghlLocationId: crm?.locationId ?? null,
    });
  }

  // Descartar un lead (no es venta).
  if (action === 'dismiss') {
    if (!body.conversationId) {
      return NextResponse.json({ error: 'Falta conversationId' }, { status: 400 });
    }
    await setRadarStatus(orgId, body.conversationId, 'descartado');
    return NextResponse.json({ ok: true });
  }

  // Crear oportunidad en GHL desde la conversación.
  if (action === 'create_opportunity') {
    if (!body.conversationId || !body.contactId) {
      return NextResponse.json({ error: 'Falta conversationId o contactId' }, { status: 400 });
    }
    if (!t.salesPipelineId) {
      return NextResponse.json(
        { error: 'No hay pipeline de ventas configurado', hint: 'Configúralo en Settings.' },
        { status: 400 },
      );
    }
    const stage = await fetchFirstStage(t.creds, t.salesPipelineId);
    if (!stage) {
      return NextResponse.json(
        { error: 'No se pudo resolver la primera etapa del pipeline de ventas' },
        { status: 502 },
      );
    }
    try {
      const opp = await createOpportunity(t.creds, {
        pipelineId: t.salesPipelineId,
        pipelineStageId: stage.id,
        contactId: body.contactId,
        name: body.contactName?.trim() || 'Lead WhatsApp',
      });
      await setRadarStatus(orgId, body.conversationId, 'convertido');
      return NextResponse.json({ ok: true, opportunityId: opp.id, stage: stage.name });
    } catch (err) {
      return NextResponse.json(
        { error: 'Error al crear la oportunidad en GHL', detail: String(err) },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ error: `Acción no soportada: ${action}` }, { status: 400 });
}
