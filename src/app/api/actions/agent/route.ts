import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings, agentActions, dealOwnership } from '@/db/schema';
import { decrypt } from '@/lib/encryption';
import {
  createContactNote,
  createContactTask,
  findColdStage,
  updateOpportunityStage,
} from '@/lib/ghl-client';
import { EXECUTABLE_ACTIONS, formatAgentNote } from '@/lib/playbook-engine';
import { recordRecommendationEvent } from '@/lib/outcomes';
import type { AgentAction } from '@/lib/taxonomy';

/**
 * Ejecución 1-click de una acción del playbook (AG-2).
 *
 * El humano aprueba con el click (nivel A1): el endpoint ejecuta la acción en
 * GHL, deja nota `[AGENTE]` en el contacto, registra la fila en `agent_actions`
 * y el evento de outcome tracking. Solo acciones que tocan CRM/vendedor —
 * contactar al cliente es AG-4.
 */

type AgentActionBody = {
  action: AgentAction;
  /** Oportunidad (ghlId). */
  dealId: string;
  contactId: string;
  contactName?: string;
  /** ID del pipeline del deal (para ubicar la etapa Frío). */
  pipelineId?: string;
  rationale?: string;
  taskDueInDays?: number;
  value?: number;
};

export async function POST(request: Request) {
  const { orgId, userId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: AgentActionBody;
  try {
    body = (await request.json()) as AgentActionBody;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body.dealId || !body.contactId || !EXECUTABLE_ACTIONS.includes(body.action)) {
    return NextResponse.json(
      { error: `Se requiere dealId, contactId y action (${EXECUTABLE_ACTIONS.join(' | ')}).` },
      { status: 400 },
    );
  }

  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  if (!row?.ghlApiToken || !row?.ghlLocationId) {
    return NextResponse.json(
      { error: 'GHL no configurado', hint: 'Configura GHL en Settings.' },
      { status: 400 },
    );
  }
  const creds = { token: decrypt(row.ghlApiToken), locationId: row.ghlLocationId };

  const rationale = body.rationale ?? 'Acción del playbook.';
  const name = body.contactName ? ` — ${body.contactName}` : '';
  const ghlRefs: Record<string, string | undefined> = {};

  try {
    if (body.action === 'crear_tarea_vendedor' || body.action === 'escalar_a_humano') {
      const urgent = body.action === 'escalar_a_humano';
      const dueDays = urgent ? 1 : (body.taskDueInDays ?? 7);
      const task = await createContactTask(creds, body.contactId, {
        title: urgent ? `⚠️ Atender ahora${name}` : `Seguimiento pendiente${name}`,
        body: rationale,
        dueDate: new Date(Date.now() + dueDays * 24 * 3600 * 1000).toISOString(),
      });
      ghlRefs.taskId = task.id;
    } else if (body.action === 'mover_a_frio') {
      const pipelineId = body.pipelineId ?? row.ghlSalesPipelineId;
      if (!pipelineId) {
        return NextResponse.json(
          { error: 'Sin pipeline para ubicar la etapa Frío (configura el pipeline de ventas).' },
          { status: 400 },
        );
      }
      const cold = await findColdStage(creds, pipelineId);
      if (!cold) {
        return NextResponse.json(
          { error: 'El pipeline no tiene una etapa Frío reconocible.' },
          { status: 400 },
        );
      }
      await updateOpportunityStage(creds, body.dealId, cold.id);
      ghlRefs.stageId = cold.id;
    }
    // crear_nota: la nota [AGENTE] de abajo ES la acción.

    const note = await createContactNote(
      creds,
      body.contactId,
      formatAgentNote(body.action, rationale),
    );
    ghlRefs.noteId = note.id;

    await db.insert(agentActions).values({
      tenantId: orgId,
      dealGhlId: body.dealId,
      contactId: body.contactId,
      action: body.action,
      params: JSON.stringify({ rationale, taskDueInDays: body.taskDueInDays }),
      status: 'executed',
      decidedBy: 'playbook',
      approvedBy: userId ?? undefined,
      executedAt: new Date(),
      ghlRefs: JSON.stringify(ghlRefs),
    });

    // Escalar deja registro de ownership: el deal queda en manos del vendedor.
    if (body.action === 'escalar_a_humano') {
      await db.insert(dealOwnership).values({
        tenantId: orgId,
        dealGhlId: body.dealId,
        owner: 'escalado',
        reason: rationale,
        actor: userId ?? 'playbook',
      });
    }

    await recordRecommendationEvent({
      tenantId: orgId,
      dealGhlId: body.dealId,
      contactId: body.contactId,
      engine: 'live_opp',
      action: body.action,
      statusAtEvent: 'open',
      valueAtEvent: body.value,
      payload: ghlRefs,
    });

    return NextResponse.json({ ok: true, action: body.action, ghlRefs });
  } catch (err) {
    await db
      .insert(agentActions)
      .values({
        tenantId: orgId,
        dealGhlId: body.dealId,
        contactId: body.contactId,
        action: body.action,
        params: JSON.stringify({ rationale }),
        status: 'failed',
        decidedBy: 'playbook',
        approvedBy: userId ?? undefined,
        error: String(err),
      })
      .catch(() => {});
    return NextResponse.json(
      { error: 'Error al ejecutar la acción en GHL', detail: String(err) },
      { status: 502 },
    );
  }
}
