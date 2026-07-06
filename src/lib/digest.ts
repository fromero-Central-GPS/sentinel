/**
 * Digest matinal por vendedor (P1-2).
 *
 * Para cada vendedor (assignedTo) arma un resumen corto con sus oportunidades
 * abiertas en riesgo alto/crítico (según Live Opp) y las acciones recomendadas.
 * Se envía por WhatsApp (ver `whatsapp.ts`). Lee del funnel sincronizado, así
 * que no golpea la API de GHL (salvo el mapa de usuarios para nombre/teléfono).
 */

import type { GhlCredentials } from '@/lib/ghl-client';
import { fetchUsersDetailed, type GhlUser } from '@/lib/ghl-client';
import { getSyncedDeals } from '@/lib/deal-sync';
import { getTenantThresholds } from '@/lib/won-track-store';
import { analyzeLiveOpportunity, getDefaultThresholds } from '@/lib/live-opp-engine';
import { getMetaCreds, sendWhatsAppDigest, type SendResult } from '@/lib/whatsapp';

/** Cuántas oportunidades como máximo se listan por vendedor en el mensaje. */
const MAX_OPPS_PER_SELLER = 5;

export interface DigestOpp {
  name: string;
  value: number;
  riskLevel: string;
  riskScore: number;
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
  text: string;
}

function fmtClp(n: number): string {
  return n.toLocaleString('es-CL', { maximumFractionDigits: 0 });
}

function composeText(d: Omit<SellerDigest, 'text'>): string {
  const lines: string[] = [
    `Buenos días, ${d.sellerName}. Resumen Sentinel de hoy:`,
    `🔴 ${d.criticalCount} críticas · 🟠 ${d.highCount} en riesgo · $${fmtClp(d.totalValueAtRisk)} CLP en juego.`,
    '',
  ];
  d.opps.forEach((o, i) => {
    const emoji = o.riskLevel === 'critical' ? '🔴' : o.riskLevel === 'high' ? '🟠' : '🟡';
    lines.push(`${i + 1}. ${emoji} ${o.name} — $${fmtClp(o.value)}`);
    lines.push(`   → ${o.topAction}`);
  });
  return lines.join('\n');
}

/**
 * Arma los digests por vendedor del tenant. Solo incluye vendedores con al
 * menos una oportunidad en riesgo alto/crítico.
 */
export async function buildTenantDigests(
  tenantId: string,
  creds: GhlCredentials,
): Promise<SellerDigest[]> {
  const [synced, thresholdsRaw, users] = await Promise.all([
    getSyncedDeals(tenantId, 'open'),
    getTenantThresholds(tenantId),
    fetchUsersDetailed(creds),
  ]);
  if (synced.length === 0) return [];

  const thresholds = thresholdsRaw ?? getDefaultThresholds();
  const userById = new Map<string, GhlUser>(users.map((u) => [u.id, u]));

  // Agrupa las oportunidades en riesgo por vendedor asignado.
  const bySeller = new Map<string, DigestOpp[]>();
  for (const { deal, messages } of synced) {
    if (!deal.assignedTo) continue;
    const a = analyzeLiveOpportunity(deal, messages, thresholds);
    if (a.riskLevel !== 'critical' && a.riskLevel !== 'high') continue;
    const list = bySeller.get(deal.assignedTo) ?? [];
    list.push({
      name: a.contactName || deal.name || a.opportunityId,
      value: a.value,
      riskLevel: a.riskLevel,
      riskScore: a.overallRiskScore,
      topAction: a.recommendedActions[0] ?? 'Revisar la oportunidad.',
    });
    bySeller.set(deal.assignedTo, list);
  }

  const digests: SellerDigest[] = [];
  for (const [sellerId, opps] of bySeller) {
    opps.sort((a, b) => b.riskScore - a.riskScore);
    const user = userById.get(sellerId);
    const base = {
      sellerId,
      sellerName: user?.name ?? 'vendedor',
      phone: user?.phone,
      criticalCount: opps.filter((o) => o.riskLevel === 'critical').length,
      highCount: opps.filter((o) => o.riskLevel === 'high').length,
      totalValueAtRisk: opps.reduce((s, o) => s + o.value, 0),
      opps: opps.slice(0, MAX_OPPS_PER_SELLER),
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
): Promise<DigestRunResult> {
  try {
    const digests = await buildTenantDigests(tenantId, creds);
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
