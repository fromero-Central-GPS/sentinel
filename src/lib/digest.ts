/**
 * Digest matinal por vendedor (P1-2).
 *
 * Para cada vendedor (assignedTo) arma un resumen corto con sus oportunidades
 * abiertas en riesgo alto/crítico (según Live Opp) y las acciones recomendadas.
 * Se envía por WhatsApp (ver `whatsapp.ts`). Lee del funnel sincronizado, así
 * que no golpea la API de GHL (salvo el mapa de usuarios para nombre/teléfono).
 */

import { and, eq, gte, inArray, or } from 'drizzle-orm';
import { db } from '@/db';
import { agentActions } from '@/db/schema';
import type { GhlCredentials } from '@/lib/ghl-client';
import { fetchUserById, mapWithConcurrency, type GhlUser } from '@/lib/ghl-client';
import { getSyncedDeals } from '@/lib/deal-sync';
import { getTenantThresholds } from '@/lib/won-track-store';
import { analyzeLiveOpportunity, getDefaultThresholds } from '@/lib/live-opp-engine';
import { decidePlaybookAction, ACTION_LABELS } from '@/lib/playbook-engine';
import type { AgentAction } from '@/lib/taxonomy';
import { getMetaCreds, sendWhatsAppDigest, type SendResult } from '@/lib/whatsapp';

/** Cuántas oportunidades como máximo se listan por vendedor en el mensaje. */
const MAX_OPPS_PER_SELLER = 5;

export interface DigestOpp {
  name: string;
  value: number;
  riskLevel: string;
  riskScore: number;
  /** Acción tipificada del playbook (AG-1). */
  action: AgentAction;
  topAction: string;
}

export interface SellerDigest {
  sellerId: string;
  sellerName: string;
  phone?: string;
  criticalCount: number;
  highCount: number;
  totalValueAtRisk: number;
  opps: DigestOpp[];
  /** Actividad del agente sobre los deals del vendedor (AG-3). */
  agentExecuted: number;
  agentProposed: number;
  text: string;
}

function fmtClp(n: number): string {
  return n.toLocaleString('es-CL', { maximumFractionDigits: 0 });
}

function composeText(d: Omit<SellerDigest, 'text'>): string {
  // El saludo y el cierre los aporta la plantilla de WhatsApp
  // (`sentinel_digest_diario`): "Hola 👋 Tu resumen Sentinel de hoy: {{1}} …".
  // Este texto es la variable {{1}}, así que arranca directo en el contenido
  // para no duplicar el saludo.
  const lines: string[] = [
    `${d.sellerName}, esto es lo que necesita tu atención hoy:`,
    `🔴 ${d.criticalCount} críticas · 🟠 ${d.highCount} en riesgo · $${fmtClp(d.totalValueAtRisk)} CLP en juego.`,
    '',
  ];
  d.opps.forEach((o, i) => {
    const emoji = o.riskLevel === 'critical' ? '🔴' : o.riskLevel === 'high' ? '🟠' : '🟡';
    lines.push(`${i + 1}. ${emoji} ${o.name} — $${fmtClp(o.value)}`);
    lines.push(`   → ${o.topAction}`);
  });
  if (d.agentExecuted > 0 || d.agentProposed > 0) {
    const parts: string[] = [];
    if (d.agentExecuted > 0)
      parts.push(`hizo ${d.agentExecuted} acción${d.agentExecuted === 1 ? '' : 'es'} por ti (últ. 24h)`);
    if (d.agentProposed > 0)
      parts.push(`${d.agentProposed} esperando tu OK en Sentinel`);
    lines.push('', `🤖 Agente: ${parts.join(' · ')}.`);
  }
  return lines.join('\n');
}

/**
 * Arma los digests por vendedor del tenant. Solo incluye vendedores con al
 * menos una oportunidad en riesgo alto/crítico.
 */
export async function buildTenantDigests(
  tenantId: string,
  creds: GhlCredentials,
  salesPipelineId?: string | null,
): Promise<SellerDigest[]> {
  // `getSyncedDeals` ya restringe al pipeline de ventas configurado del tenant
  // (los pipelines post-venta quedan fuera), así que aquí solo agrupamos.
  const [synced, thresholdsRaw] = await Promise.all([
    getSyncedDeals(tenantId, 'open'),
    getTenantThresholds(tenantId),
  ]);
  if (synced.length === 0) return [];

  const thresholds = thresholdsRaw ?? getDefaultThresholds();

  // Agrupa las oportunidades en riesgo por vendedor asignado (dueño de la
  // oportunidad, `deal.assignedTo`).
  const bySeller = new Map<string, DigestOpp[]>();
  for (const { deal, messages } of synced) {
    // Solo el pipeline de ventas configurado (si lo hay): las oportunidades de
    // pipelines post-venta (On Boarding, Up Sell…) ya están ganadas y NO deben
    // aparecer como negocios abiertos en riesgo. Su `assignedTo` además suele
    // ser el dueño del contacto, no del vendedor, así que filtrarlas evita
    // también avisar a la persona equivocada.
    if (salesPipelineId && deal.pipelineId !== salesPipelineId) continue;
    if (!deal.assignedTo) continue;
    const a = analyzeLiveOpportunity(deal, messages, thresholds);
    if (a.riskLevel !== 'critical' && a.riskLevel !== 'high') continue;
    // Playbook (AG-1): decide UNA acción tipificada por deal. Los deals en
    // gestión activa o pausados no le suman ruido al digest del vendedor.
    const decision = decidePlaybookAction(deal, messages, a);
    if (decision.action === 'no_tocar') continue;
    const list = bySeller.get(deal.assignedTo) ?? [];
    list.push({
      name: a.contactName || deal.name || a.opportunityId,
      value: a.value,
      riskLevel: a.riskLevel,
      riskScore: a.overallRiskScore,
      action: decision.action,
      topAction:
        decision.action === 'monitorear'
          ? (a.recommendedActions[0] ?? 'Revisar la oportunidad.')
          : `${ACTION_LABELS[decision.action]}: ${decision.rationale}`,
    });
    bySeller.set(deal.assignedTo, list);
  }
  if (bySeller.size === 0) return [];

  // Actividad del agente (AG-3) sobre los deals de cada vendedor: ejecutado en
  // las últimas 24h + propuestas pendientes. Una consulta por tenant.
  const dealOwner = new Map<string, string>();
  for (const { deal } of synced) {
    if (deal.assignedTo && (!salesPipelineId || deal.pipelineId === salesPipelineId)) {
      dealOwner.set(deal.id, deal.assignedTo);
    }
  }
  const agentBySeller = new Map<string, { executed: number; proposed: number }>();
  try {
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const rows = await db
      .select({
        dealGhlId: agentActions.dealGhlId,
        status: agentActions.status,
      })
      .from(agentActions)
      .where(
        and(
          eq(agentActions.tenantId, tenantId),
          or(
            eq(agentActions.status, 'proposed'),
            and(eq(agentActions.status, 'executed'), gte(agentActions.updatedAt, dayAgo)),
          ),
          inArray(agentActions.dealGhlId, [...dealOwner.keys()]),
        ),
      );
    for (const r of rows) {
      const seller = dealOwner.get(r.dealGhlId);
      if (!seller) continue;
      const acc = agentBySeller.get(seller) ?? { executed: 0, proposed: 0 };
      if (r.status === 'executed') acc.executed++;
      else acc.proposed++;
      agentBySeller.set(seller, acc);
    }
  } catch {
    // La actividad del agente es opcional en el digest: no rompas el envío.
  }

  // Resuelve nombre + teléfono de cada vendedor asignado por su ID
  // (`GET /users/{id}`): el listado de la location devuelve el `phone` vacío, y
  // así solo consultamos los usuarios que realmente tienen oportunidades en
  // riesgo.
  const sellerIds = [...bySeller.keys()];
  const fetched = await mapWithConcurrency(sellerIds, 4, (id) => fetchUserById(creds, id));
  const userById = new Map<string, GhlUser>();
  fetched.forEach((u, i) => {
    if (u) userById.set(sellerIds[i], u);
  });

  const digests: SellerDigest[] = [];
  for (const [sellerId, opps] of bySeller) {
    opps.sort((a, b) => b.riskScore - a.riskScore);
    const user = userById.get(sellerId);
    const agent = agentBySeller.get(sellerId) ?? { executed: 0, proposed: 0 };
    const base = {
      sellerId,
      sellerName: user?.name ?? 'vendedor',
      phone: user?.phone,
      criticalCount: opps.filter((o) => o.riskLevel === 'critical').length,
      highCount: opps.filter((o) => o.riskLevel === 'high').length,
      totalValueAtRisk: opps.reduce((s, o) => s + o.value, 0),
      opps: opps.slice(0, MAX_OPPS_PER_SELLER),
      agentExecuted: agent.executed,
      agentProposed: agent.proposed,
    };
    digests.push({ ...base, text: composeText(base) });
  }

  // Vendedores con más valor en riesgo primero.
  digests.sort((a, b) => b.totalValueAtRisk - a.totalValueAtRisk);
  return digests;
}

export interface DigestRunResult {
  tenantId: string;
  sellers: number;
  sent: number;
  dryRun: number;
  skippedNoPhone: number;
  errors: string[];
  /** Presente en dry-run: los textos compuestos (para inspección). */
  preview?: Array<{ seller: string; phone?: string; text: string }>;
  error?: string;
}

/**
 * Construye y envía los digests del tenant. Si no hay credenciales Meta o
 * plantilla configurada, hace dry-run y devuelve el preview.
 */
export async function runDigestForTenant(
  tenantId: string,
  creds: GhlCredentials,
  salesPipelineId?: string | null,
): Promise<DigestRunResult> {
  try {
    const digests = await buildTenantDigests(tenantId, creds, salesPipelineId);
    if (digests.length === 0) {
      return { tenantId, sellers: 0, sent: 0, dryRun: 0, skippedNoPhone: 0, errors: [] };
    }

    const metaCreds = await getMetaCreds(tenantId);
    let sent = 0;
    let dryRun = 0;
    let skippedNoPhone = 0;
    const errors: string[] = [];
    const preview: Array<{ seller: string; phone?: string; text: string }> = [];

    for (const d of digests) {
      preview.push({ seller: d.sellerName, phone: d.phone, text: d.text });
      if (!d.phone) {
        skippedNoPhone++;
        continue;
      }
      if (!metaCreds) {
        dryRun++;
        continue;
      }
      const result: SendResult = await sendWhatsAppDigest(metaCreds, d.phone, d.text);
      if (result.sent) sent++;
      else if (result.dryRun) dryRun++;
      else errors.push(`${d.sellerName}: ${result.error}`);
    }

    return {
      tenantId,
      sellers: digests.length,
      sent,
      dryRun,
      skippedNoPhone,
      errors,
      preview: sent === 0 ? preview : undefined,
    };
  } catch (err) {
    return {
      tenantId,
      sellers: 0,
      sent: 0,
      dryRun: 0,
      skippedNoPhone: 0,
      errors: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
