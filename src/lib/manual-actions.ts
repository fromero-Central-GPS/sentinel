/**
 * Acciones manuales de Live Opp (A1: el humano decide y ejecuta).
 *
 * A diferencia de `agent-executor` (que ejecuta la ÚNICA acción decidida por el
 * playbook), acá el usuario elige libremente qué hacer sobre una oportunidad:
 * comentario interno (con o sin @mención al ejecutivo), nota, tarea o mover a
 * cualquier etapa del pipeline. No pasa por la matriz de autonomía; toca GHL
 * directo con los primitivos de `ghl-client` y deja bitácora en `agent_actions`.
 */

import { db } from '@/db';
import { agentActions } from '@/db/schema';
import {
  buildUserMention,
  createContactNote,
  createContactTask,
  fetchConversationIdByContact,
  sendInternalComment,
  updateOpportunityStage,
  type GhlCredentials,
} from './ghl-client';

export const MANUAL_ACTION_KINDS = [
  'comentario_interno',
  'nota',
  'tarea',
  'cambiar_etapa',
] as const;
export type ManualActionKind = (typeof MANUAL_ACTION_KINDS)[number];

export interface ManualActionRequest {
  kind: ManualActionKind;
  /** Oportunidad (ghlId). */
  dealId: string;
  contactId: string;
  /** Texto libre (cuerpo del comentario/nota/tarea). */
  text?: string;
  /** Cambiar etapa: etapa destino (id) y su nombre (para bitácora). */
  targetStageId?: string;
  targetStageName?: string;
  /** Tarea: vencimiento en días (default 7). */
  taskDueInDays?: number;
  /** Comentario interno: si arrobar al ejecutivo asignado. */
  mention?: boolean;
  assignedUserId?: string | null;
  assignedUserName?: string | null;
}

export class ManualActionError extends Error {}

/**
 * Ejecuta una acción manual en GHL y deja la fila en `agent_actions`
 * (`decidedBy: 'humano'`). Lanza `ManualActionError` con mensaje legible ante
 * validaciones de entrada; registra la fila 'failed' ante errores de GHL y relanza.
 */
export async function executeManualAction(
  tenantId: string,
  creds: GhlCredentials,
  req: ManualActionRequest,
  approvedBy: string | null,
): Promise<Record<string, string | undefined>> {
  const ghlRefs: Record<string, string | undefined> = {};
  const text = req.text?.trim() ?? '';

  try {
    if (req.kind === 'comentario_interno') {
      if (!text) throw new ManualActionError('El comentario no puede estar vacío.');
      const conversationId = await fetchConversationIdByContact(creds, req.contactId).catch(
        () => null,
      );
      if (!conversationId) {
        throw new ManualActionError(
          'El contacto no tiene una conversación en GHL — no se puede dejar un comentario interno.',
        );
      }
      const mention =
        req.mention && req.assignedUserId
          ? ` ${buildUserMention(req.assignedUserName, req.assignedUserId)}`
          : '';
      const comment = await sendInternalComment(creds, {
        contactId: req.contactId,
        conversationId,
        message: `${text}${mention}`,
        mentions: req.mention && req.assignedUserId ? [req.assignedUserId] : [],
      });
      ghlRefs.internalCommentId = comment.id ?? 'sent';
    } else if (req.kind === 'nota') {
      if (!text) throw new ManualActionError('La nota no puede estar vacía.');
      const note = await createContactNote(creds, req.contactId, text);
      ghlRefs.noteId = note.id;
    } else if (req.kind === 'tarea') {
      if (!text) throw new ManualActionError('La tarea necesita una descripción.');
      const dueDays = req.taskDueInDays ?? 7;
      const task = await createContactTask(creds, req.contactId, {
        title: text.length > 60 ? `${text.slice(0, 60)}…` : text,
        body: text,
        dueDate: new Date(Date.now() + dueDays * 24 * 3600 * 1000).toISOString(),
      });
      ghlRefs.taskId = task.id;
    } else if (req.kind === 'cambiar_etapa') {
      if (!req.targetStageId) throw new ManualActionError('Falta la etapa destino.');
      await updateOpportunityStage(creds, req.dealId, req.targetStageId);
      ghlRefs.stageId = req.targetStageId;
      // Bitácora visible en GHL del cambio manual de etapa.
      await createContactNote(
        creds,
        req.contactId,
        `[SENTINEL] Etapa cambiada manualmente → ${req.targetStageName ?? req.targetStageId}`,
      ).catch(() => {});
    } else {
      throw new ManualActionError('Acción manual no reconocida.');
    }

    await db.insert(agentActions).values({
      tenantId,
      dealGhlId: req.dealId,
      contactId: req.contactId,
      action: req.kind,
      params: JSON.stringify({
        text: text || undefined,
        targetStageId: req.targetStageId,
        targetStageName: req.targetStageName,
        mention: req.mention || undefined,
      }),
      status: 'executed',
      decidedBy: 'humano',
      approvedBy: approvedBy ?? undefined,
      executedAt: new Date(),
      ghlRefs: JSON.stringify(ghlRefs),
    });

    return ghlRefs;
  } catch (err) {
    if (!(err instanceof ManualActionError)) {
      await db
        .insert(agentActions)
        .values({
          tenantId,
          dealGhlId: req.dealId,
          contactId: req.contactId,
          action: req.kind,
          params: JSON.stringify({ text: text || undefined, targetStageId: req.targetStageId }),
          status: 'failed',
          decidedBy: 'humano',
          approvedBy: approvedBy ?? undefined,
          error: String(err),
        })
        .catch(() => {});
    }
    throw err;
  }
}
