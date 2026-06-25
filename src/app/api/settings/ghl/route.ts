import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { decrypt, encrypt, isMasked, maskToken } from '@/lib/encryption';

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  if (!row) return NextResponse.json({ ghlApiToken: null, ghlLocationId: null });

  return NextResponse.json({
    ghlApiToken: row.ghlApiToken ? maskToken(decrypt(row.ghlApiToken)) : null,
    ghlLocationId: row.ghlLocationId,
  });
}

export async function POST(req: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { ghlApiToken, ghlLocationId } = body as { ghlApiToken?: string; ghlLocationId?: string };

  const [existing] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));

  let tokenToStore: string | undefined = existing?.ghlApiToken ?? undefined;

  if (ghlApiToken !== undefined && !isMasked(ghlApiToken)) {
    tokenToStore = encrypt(ghlApiToken);
  }

  const now = new Date();

  if (existing) {
    await db
      .update(appSettings)
      .set({
        ghlApiToken: tokenToStore,
        ghlLocationId: ghlLocationId ?? existing.ghlLocationId,
        updatedAt: now,
      })
      .where(eq(appSettings.tenantId, orgId));
  } else {
    await db.insert(appSettings).values({
      tenantId: orgId,
      ghlApiToken: tokenToStore,
      ghlLocationId: ghlLocationId ?? null,
    });
  }

  return NextResponse.json({ ok: true });
}
