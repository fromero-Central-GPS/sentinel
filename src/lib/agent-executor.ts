/**
 * Executor de acciones del agente (AG-2/AG-3).
 *
 * Único punto que ejecuta una acción tipificada contra GHL: lo usan el botón
 * 1-click de Live Opp (aprobación humana) y el cron del agente (modo `auto`).
 * Toda ejecución deja nota [AGENTE] en el contacto, registra la fila en
 * `agent_actions` (o promueve la propuesta pendiente) y el evento de outcome.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentActions, dealOwnership } from '@/db/schema';
import {
  createContactNote,
  createContactTask,
  findColdStage,
  updateOpportunityStage,
  type GhlCredentials,
} from './ghl-client';
import { formatAgentNote } from './playbook-engine';
import { recordRecommendationEvent } from './outcomes';
import type { AgentAction } from './taxonomy';

export interface AgentActionRequest {
  action: AgentAction;
  /** Oportunidad (ghlId). */
  dealId: string;
  contactId: string;
  contactName?: string;
  /** Pipeline del deal (para ubicar la etapa Frío); cae al de ventas del tenant. */
  pipelineId?: string | null;
  rationale?: string;
  taskDueInDays?: number;
  value?: number;
}

export interface ExecuteMeta {
  /** Quién decidió la acción ('playbook') y quién la aprobó (Clerk userId o null si fue autónoma). */
  decidedBy?: string;
  approvedBy?: string | null;
}

export class AgentActionError extends Error {}

/**
 * Ejecuta la acción en GHL y persiste la bitácora. Lanza `AgentActionError`
 * con mensaje legible si la config no alcanza (p.ej. sin etapa Frío); registra
 * la fila 'failed' ante errores de GHL y relanza.
 */
export async function executeAgentAction(
  tenantId: string,
  creds: GhlCredentials,
  salesPipelineId: string | null,
  req: AgentActionRequest,
  meta: ExecuteMeta = {},
): Promise<Record<string, string | undefined>> {
  const rationale = req.rationale ?? 'Acción del playbook.';
  const name = req.contactName ? ` — ${req.contactName}` : '';
  const ghlRefs: Record<string, string | undefined> = {};

  try {
    if (req.action === 'crear_tarea_vendedor' || req.action === 'escalar_a_humano') {
      const urgent = req.action === 'escalar_a_humano';
      const dueDays = urgent ? 1 : (req.taskDueInDays ?? 7);
      const task = await createContactTask(creds, req.contactId, {
        title: urgent ? `⚠️ Atender ahora${name}` : `Seguimiento pendiente${name}`,
        body: rationale,
        dueDate: new Date(Date.now() + dueDays * 24 * 3600 * 1000).toISOString(),
      });
      ghlRefs.taskId = task.id;
    } else if (req.action === 'mover_a_frio') {
      const pipelineId = req.pipelineId ?? salesPipelineId;
      if (!pipelineId) {
        throw new AgentActionError(
          'Sin pipeline para ubicar la etapa Frío (configura el pipeline de ventas).',
        );
      }
      const cold = await findColdStage(creds, pipelineId);
      if (!cold) throw new AgentActionError('El pipeline no tiene una etapa Frío reconocible.');
      await updateOpportunityStage(creds, req.dealId, cold.id);
      ghlRefs.stageId = cold.id;
    }
    // crear_nota: la nota [AGENTE] de abajo ES la acción.

    const note = await createContactNote(creds, req.contactId, formatAgentNote(req.action, rationale));
    ghlRefs.noteId = note.id;

    // Si el cron ya había encolado esta acción, promueve la propuesta en vez
    // de duplicar la fila.
    const [pending] = await db
      .select({ id: agentActions.id })
      .from(agentActions)
      .where(
        and(
          eq(agentActions.tenantId, tenantId),
          eq(agentActions.dealGhlId, req.dealId),
          eq(agentActions.action, req.action),
          eq(agentActions.status, 'proposed'),
        ),
      )
      .limit(1);

    const rowValues = {
      params: JSON.stringify({ rationale, taskDueInDays: req.taskDueInDays }),
      status: 'executed',
      decidedBy: meta.decidedBy ?? 'playbook',
      approvedBy: meta.approvedBy ?? undefined,
      executedAt: new Date(),
      ghlRefs: JSON.stringify(ghlRefs),
      updatedAt: new Date(),
    };
    if (pending) {
      await db.update(agentActions).set(rowValues).where(eq(agentActions.id, pending.id));
    } else {
      await db.insert(agentActions).values({
        tenantId,
        dealGhlId: req.dealId,
        contactId: req.contactId,
        action: req.action,
        ...rowValues,
      });
    }

    // Escalar deja registro de ownership: el deal queda en manos del vendedor.
    if (req.action === 'escalar_a_humano') {
      await db.insert(dealOwnership).values({
        tenantId,
        dealGhlId: req.dealId,
        owner: 'escalado',
        reason: rationale,
        actor: meta.approvedBy ?? 'playbook',
      });
    }

    await recordRecommendationEvent({
      tenantId,
      dealGhlId: req.dealId,
      contactId: req.contactId,
      engine: 'live_opp',
      action: req.action,
      statusAtEvent: 'open',
      valueAtEvent: req.value,
      payload: ghlRefs,
    });

    return ghlRefs;
  } catch (err) {
    if (!(err instanceof AgentActionError)) {
      await db
        .insert(agentActions)
        .values({
          tenantId,
          dealGhlId: req.dealId,
          contactId: req.contactId,
          action: req.action,
          params: JSON.stringify({ rationale }),
          status: 'failed',
          decidedBy: meta.decidedBy ?? 'playbook',
          approvedBy: meta.approvedBy ?? undefined,
          error: String(err),
        })
        .catch(() => {});
    }
    throw err;
  }
}
