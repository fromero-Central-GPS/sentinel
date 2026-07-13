import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { decrypt } from '@/lib/encryption';
import { EXECUTABLE_ACTIONS } from '@/lib/playbook-engine';
import {
  executeAgentAction,
  AgentActionError,
  type AgentActionRequest,
} from '@/lib/agent-executor';

/**
 * Ejecución 1-click de una acción del playbook (AG-2, nivel A1: el click del
 * humano ES la aprobación). La lógica vive en `agent-executor` — la comparte
 * con el cron del agente (AG-3, modo `auto`).
 */

export async function POST(request: Request) {
  const { orgId, userId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: AgentActionRequest;
  try {
    body = (await request.json()) as AgentActionRequest;
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

  try {
    const ghlRefs = await executeAgentAction(orgId, creds, row.ghlSalesPipelineId, body, {
      decidedBy: 'playbook',
      approvedBy: userId,
    });
    return NextResponse.json({ ok: true, action: body.action, ghlRefs });
  } catch (err) {
    if (err instanceof AgentActionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Error al ejecutar la acción en GHL', detail: String(err) },
      { status: 502 },
    );
  }
}
