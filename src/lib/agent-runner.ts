/**
 * Cron del agente (AG-3): evalúa el playbook sobre el funnel sincronizado y,
 * según la matriz de autonomía del tenant, encola propuestas ('proposed') o
 * ejecuta solo ('auto', nivel A2) las acciones de bajo riesgo.
 *
 * Lee de la BD (como el digest): no golpea la API de GHL salvo para ejecutar.
 * Dedupe: no re-propone si ya hay una propuesta pendiente ni si la misma
 * acción se ejecutó hace menos de `DEDUPE_DAYS` días sobre el mismo deal.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { agentActions } from '@/db/schema';
import type { GhlCredentials } from './ghl-client';
import { getSyncedDeals } from './deal-sync';
import { getTenantThresholds } from './won-track-store';
import { analyzeLiveOpportunity, getDefaultThresholds } from './live-opp-engine';
import { decidePlaybookAction, EXECUTABLE_ACTIONS } from './playbook-engine';
import { parseAutonomyConfig, type AutonomyConfig } from './agent-autonomy';
import { executeAgentAction } from './agent-executor';
import type { AgentAction } from './taxonomy';

/** Días sin re-proponer/re-ejecutar la misma acción sobre el mismo deal. */
const DEDUPE_DAYS = 7;
/** Tope de ejecuciones autónomas por corrida (presupuesto de seguridad, doc §6). */
const MAX_AUTO_PER_RUN = 15;

export interface AgentRunResult {
  tenantId: string;
  evaluated: number;
  proposed: number;
  executed: number;
  skippedDedupe: number;
  errors: string[];
  /** En dryRun: lo que HARÍA (acción + deal + modo). */
  preview?: Array<{ deal: string; contact: string; action: string; mode: string }>;
  error?: string;
}

export async function runAgentForTenant(
  tenantId: string,
  creds: GhlCredentials,
  salesPipelineId: string | null,
  rawAutonomy: string | null | undefined,
  opts?: { dryRun?: boolean },
): Promise<AgentRunResult> {
  const result: AgentRunResult = {
    tenantId,
    evaluated: 0,
    proposed: 0,
    executed: 0,
    skippedDedupe: 0,
    errors: [],
    preview: opts?.dryRun ? [] : undefined,
  };

  try {
    const autonomy: AutonomyConfig = parseAutonomyConfig(rawAutonomy);
    // Sin nada habilitado no hay trabajo (default: propose para lo ejecutable).
    if (EXECUTABLE_ACTIONS.every((a) => autonomy[a] === 'off')) return result;

    const [synced, thresholdsRaw] = await Promise.all([
      getSyncedDeals(tenantId, 'open'),
      getTenantThresholds(tenantId),
    ]);
    if (synced.length === 0) return result;
    const thresholds = thresholdsRaw ?? getDefaultThresholds();

    // Historial reciente para el dedupe (una consulta por corrida).
    const cutoff = Date.now() - DEDUPE_DAYS * 24 * 3600 * 1000;
    const recent = await db
      .select({
        dealGhlId: agentActions.dealGhlId,
        action: agentActions.action,
        status: agentActions.status,
        createdAt: agentActions.createdAt,
      })
      .from(agentActions)
      .where(
        and(eq(agentActions.tenantId, tenantId), inArray(agentActions.status, ['proposed', 'executed'])),
      );
    const blocked = new Set<string>();
    for (const r of recent) {
      const isPending = r.status === 'proposed';
      const isRecent = r.createdAt.getTime() >= cutoff;
      if (isPending || isRecent) blocked.add(`${r.dealGhlId}:${r.action}`);
    }

    let autoBudget = MAX_AUTO_PER_RUN;

    for (const { deal, messages } of synced) {
      if (salesPipelineId && deal.pipelineId !== salesPipelineId) continue;
      result.evaluated++;

      const analysis = analyzeLiveOpportunity(deal, messages, thresholds);
      const decision = decidePlaybookAction(deal, messages, analysis);
      const action: AgentAction = decision.action;
      if (!EXECUTABLE_ACTIONS.includes(action)) continue;

      const mode = autonomy[action];
      if (mode === 'off') continue;

      if (blocked.has(`${deal.id}:${action}`)) {
        result.skippedDedupe++;
        continue;
      }

      if (opts?.dryRun) {
        result.preview!.push({
          deal: deal.id,
          contact: deal.contact.name,
          action,
          mode,
        });
        if (mode === 'auto') result.executed++;
        else result.proposed++;
        continue;
      }

      if (mode === 'auto' && autoBudget > 0) {
        try {
          await executeAgentAction(
            tenantId,
            creds,
            salesPipelineId,
            {
              action,
              dealId: deal.id,
              contactId: deal.contactId,
              contactName: deal.contact.name,
              pipelineId: deal.pipelineId,
              rationale: decision.rationale,
              taskDueInDays: decision.taskDueInDays,
              value: deal.monetaryValue,
            },
            { decidedBy: 'playbook', approvedBy: null },
          );
          autoBudget--;
          result.executed++;
        } catch (err) {
          result.errors.push(`${deal.id}/${action}: ${String(err)}`);
        }
        continue;
      }

      // mode === 'propose' (o auto sin presupuesto): encolar propuesta.
      await db.insert(agentActions).values({
        tenantId,
        dealGhlId: deal.id,
        contactId: deal.contactId,
        action,
        params: JSON.stringify({
          rationale: decision.rationale,
          taskDueInDays: decision.taskDueInDays,
          contactName: deal.contact.name,
        }),
        status: 'proposed',
        decidedBy: 'playbook',
      });
      result.proposed++;
    }

    return result;
  } catch (err) {
    return { ...result, error: err instanceof Error ? err.message : String(err) };
  }
}
