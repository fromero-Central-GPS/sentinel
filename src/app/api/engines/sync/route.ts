import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '@/lib/encryption';
import { syncDealsPage, getSyncStatus, type SyncCursor } from '@/lib/deal-sync';

/**
 * Sync full-funnel GHL → BD.
 *
 * POST procesa UNA página (≤100 opps) y devuelve el cursor; el cliente re-invoca
 * con ese cursor hasta que `done` sea true (mantiene cada request corto y
 * amigable con el timeout serverless). GET devuelve el estado del sync.
 */

async function getCreds(orgId: string) {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  if (!row?.ghlApiToken || !row?.ghlLocationId) return null;
  return { token: decrypt(row.ghlApiToken), locationId: row.ghlLocationId };
}

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getSyncStatus(orgId));
}

export async function POST(request: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const creds = await getCreds(orgId);
  if (!creds) {
    return NextResponse.json(
      { error: 'GHL not configured', hint: 'Ve a /settings y configura GHL.' },
      { status: 400 },
    );
  }

  let cursor: SyncCursor | null = null;
  try {
    const body = (await request.json().catch(() => ({}))) as { cursor?: SyncCursor | null };
    cursor = body.cursor ?? null;
  } catch {
    cursor = null;
  }

  try {
    const result = await syncDealsPage(orgId, creds, cursor);
    const status = await getSyncStatus(orgId);
    return NextResponse.json({ ...result, syncStatus: status });
  } catch (err) {
    console.error('[Sync] error:', err);
    return NextResponse.json(
      { error: 'Error sincronizando con GHL', detail: String(err) },
      { status: 502 },
    );
  }
}
