import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { decrypt, encrypt, isMasked, maskToken } from '@/lib/encryption';
import { fetchPipelines } from '@/lib/ghl-client';

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  if (!row) {
    return NextResponse.json({
      ghlApiToken: null,
      ghlLocationId: null,
      ghlSalesPipelineId: null,
      pipelines: [],
    });
  }

  // Lista de pipelines para el selector: solo si hay token + location. No
  // tumbamos la carga de Settings si GHL falla (devolvemos []).
  let pipelines: Array<{ id: string; name: string }> = [];
  if (row.ghlApiToken && row.ghlLocationId) {
    try {
      pipelines = await fetchPipelines({
        token: decrypt(row.ghlApiToken),
        locationId: row.ghlLocationId,
      });
    } catch {
      pipelines = [];
    }
  }

  return NextResponse.json({
    ghlApiToken: row.ghlApiToken ? maskToken(decrypt(row.ghlApiToken)) : null,
    ghlLocationId: row.ghlLocationId,
    ghlSalesPipelineId: row.ghlSalesPipelineId,
    pipelines,
  });
}

export async function POST(req: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { ghlApiToken, ghlLocationId, ghlSalesPipelineId } = body as {
    ghlApiToken?: string;
    ghlLocationId?: string;
    ghlSalesPipelineId?: string | null;
  };

  const [existing] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));

  let tokenToStore: string | undefined = existing?.ghlApiToken ?? undefined;

  if (ghlApiToken !== undefined && !isMasked(ghlApiToken)) {
    tokenToStore = encrypt(ghlApiToken);
  }

  // '' desde el selector significa "sin pipeline de ventas" → null.
  const pipelineToStore =
    ghlSalesPipelineId === undefined
      ? existing?.ghlSalesPipelineId ?? null
      : ghlSalesPipelineId || null;

  const now = new Date();

  if (existing) {
    await db
      .update(appSettings)
      .set({
        ghlApiToken: tokenToStore,
        ghlLocationId: ghlLocationId ?? existing.ghlLocationId,
        ghlSalesPipelineId: pipelineToStore,
        updatedAt: now,
      })
      .where(eq(appSettings.tenantId, orgId));
  } else {
    await db.insert(appSettings).values({
      tenantId: orgId,
      ghlApiToken: tokenToStore,
      ghlLocationId: ghlLocationId ?? null,
      ghlSalesPipelineId: pipelineToStore,
    });
  }

  return NextResponse.json({ ok: true });
}
