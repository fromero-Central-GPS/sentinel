import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import {
  parseAutonomyConfig,
  serializeAutonomyConfig,
  AUTONOMY_MODES,
  type AutonomyConfig,
  type AutonomyMode,
} from '@/lib/agent-autonomy';
import { EXECUTABLE_ACTIONS, ACTION_LABELS } from '@/lib/playbook-engine';

/**
 * Matriz de autonomía del agente por tenant (AG-3).
 *
 * GET: config vigente + catálogo de acciones configurables (con etiqueta).
 * POST: guarda la matriz. Las acciones que tocan al cliente quedan forzadas a
 * 'off' por `parseAutonomyConfig` (guardrail hasta AG-4).
 */

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  return NextResponse.json({
    autonomy: parseAutonomyConfig(row?.agentAutonomy),
    agentUserId: row?.ghlAgentUserId ?? null,
    configurable: EXECUTABLE_ACTIONS.map((a) => ({ action: a, label: ACTION_LABELS[a] })),
    modes: AUTONOMY_MODES,
  });
}

export async function POST(req: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { autonomy?: Partial<Record<string, AutonomyMode>>; agentUserId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  // Re-parsea sobre el default: valida modos y aplica el guardrail de cliente.
  const config: AutonomyConfig = parseAutonomyConfig(JSON.stringify(body.autonomy ?? {}));

  const [existing] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  if (!existing) {
    return NextResponse.json(
      { error: 'Configura GHL primero (no hay settings del tenant).' },
      { status: 400 },
    );
  }

  await db
    .update(appSettings)
    .set({
      agentAutonomy: serializeAutonomyConfig(config),
      ghlAgentUserId: body.agentUserId?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(appSettings.tenantId, orgId));

  return NextResponse.json({ ok: true, autonomy: config });
}
