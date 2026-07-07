import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { getLostReasonCounts } from '@/lib/deal-sync';
import {
  parseLostReasonMap,
  serializeLostReasonMap,
  resolveTeamReasons,
  type LostReasonMap,
} from '@/lib/lost-reasons';

/**
 * Etiquetas de razón de pérdida de GHL por tenant (P2).
 *
 * GET: devuelve el mapa actual + los `lostReasonId` detectados en los deals
 * sincronizados con su conteo (para que el tenant sepa qué falta por nombrar).
 * POST: guarda el mapa completo.
 */

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  const map = parseLostReasonMap(row?.ghlLostReasonMap);
  const counts = await getLostReasonCounts(orgId);

  return NextResponse.json({
    map,
    detected: resolveTeamReasons(counts, map),
  });
}

export async function POST(req: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { map?: LostReasonMap };
  try {
    body = (await req.json()) as { map?: LostReasonMap };
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const serialized = serializeLostReasonMap(body.map ?? {});

  const [existing] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  if (existing) {
    await db
      .update(appSettings)
      .set({ ghlLostReasonMap: serialized, updatedAt: new Date() })
      .where(eq(appSettings.tenantId, orgId));
  } else {
    await db.insert(appSettings).values({ tenantId: orgId, ghlLostReasonMap: serialized });
  }

  return NextResponse.json({ ok: true });
}
