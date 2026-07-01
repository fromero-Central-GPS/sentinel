import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { decrypt, encrypt, isMasked, maskToken } from '@/lib/encryption';
import { AI_TYPES, type AIType } from '@/lib/ai-config';

const VALID_TYPES = Object.keys(AI_TYPES) as AIType[];

export async function GET() {
  const { orgId, orgRole } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  return NextResponse.json({
    aiType: row?.aiType ?? 'deepseek',
    aiModel: row?.aiModel ?? '',
    aiApiKey: row?.aiApiKey ? maskToken(decrypt(row.aiApiKey)) : null,
    // La config de IA la edita solo el admin del tenant.
    isAdmin: orgRole === 'org:admin',
    defaults: AI_TYPES,
  });
}

export async function POST(req: Request) {
  const { orgId, orgRole } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (orgRole !== 'org:admin') {
    return NextResponse.json(
      { error: 'Solo el admin del tenant puede cambiar la configuración de IA.' },
      { status: 403 },
    );
  }

  const body = (await req.json()) as { aiType?: string; aiModel?: string; aiApiKey?: string };
  const aiType: AIType = VALID_TYPES.includes(body.aiType as AIType)
    ? (body.aiType as AIType)
    : 'deepseek';
  const aiModel = (body.aiModel ?? '').trim() || null;

  const [existing] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));

  // La key solo se re-encripta si el usuario mandó una nueva (no la enmascarada).
  let keyToStore: string | null = existing?.aiApiKey ?? null;
  if (body.aiApiKey !== undefined) {
    const trimmed = body.aiApiKey.trim();
    if (trimmed === '')
      keyToStore = null; // vaciar = usar OIDC de plataforma
    else if (!isMasked(trimmed)) keyToStore = encrypt(trimmed);
  }

  const now = new Date();
  if (existing) {
    await db
      .update(appSettings)
      .set({ aiType, aiModel, aiApiKey: keyToStore, updatedAt: now })
      .where(eq(appSettings.tenantId, orgId));
  } else {
    await db.insert(appSettings).values({ tenantId: orgId, aiType, aiModel, aiApiKey: keyToStore });
  }

  return NextResponse.json({ ok: true });
}
