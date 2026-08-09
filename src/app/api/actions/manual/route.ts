import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { decrypt } from '@/lib/encryption';
import {
  executeManualAction,
  ManualActionError,
  MANUAL_ACTION_KINDS,
  type ManualActionRequest,
} from '@/lib/manual-actions';

/**
 * Ejecución manual (A1) de una actividad sobre una oportunidad de Live Opp:
 * comentario interno, nota, tarea o cambio de etapa. El humano decide y el click
 * ES la aprobación. Independiente del playbook/cron.
 */

export async function POST(request: Request) {
  const { orgId, userId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: ManualActionRequest;
  try {
    body = (await request.json()) as ManualActionRequest;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body.dealId || !body.contactId || !MANUAL_ACTION_KINDS.includes(body.kind)) {
    return NextResponse.json(
      { error: `Se requiere dealId, contactId y kind (${MANUAL_ACTION_KINDS.join(' | ')}).` },
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
    const ghlRefs = await executeManualAction(orgId, creds, body, userId);
    return NextResponse.json({ ok: true, kind: body.kind, ghlRefs });
  } catch (err) {
    if (err instanceof ManualActionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Error al ejecutar la acción en GHL', detail: String(err) },
      { status: 502 },
    );
  }
}
