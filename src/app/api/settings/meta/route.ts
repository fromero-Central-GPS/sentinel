import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { decrypt, encrypt, isMasked, maskToken } from '@/lib/encryption';

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  if (!row) {
    return NextResponse.json({
      metaWabaId: null,
      metaPhoneNumberId: null,
      metaAccessToken: null,
      metaWebhookVerifyToken: null,
    });
  }

  const domain = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL ?? 'https://your-domain.com';
  const webhookUrl = `${domain}/api/webhooks/meta/whatsapp`;

  return NextResponse.json({
    metaWabaId: row.metaWabaId,
    metaPhoneNumberId: row.metaPhoneNumberId,
    metaAccessToken: row.metaAccessToken ? maskToken(decrypt(row.metaAccessToken)) : null,
    metaWebhookVerifyToken: row.metaWebhookVerifyToken,
    webhookUrl,
  });
}

export async function POST(req: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { metaWabaId, metaPhoneNumberId, metaAccessToken } = body as {
    metaWabaId?: string;
    metaPhoneNumberId?: string;
    metaAccessToken?: string;
  };

  const [existing] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));

  let accessTokenToStore: string | undefined = existing?.metaAccessToken ?? undefined;
  if (metaAccessToken !== undefined && !isMasked(metaAccessToken)) {
    accessTokenToStore = encrypt(metaAccessToken);
  }

  const webhookVerifyToken = existing?.metaWebhookVerifyToken ?? randomBytes(20).toString('hex');

  const now = new Date();

  if (existing) {
    await db
      .update(appSettings)
      .set({
        metaWabaId: metaWabaId ?? existing.metaWabaId,
        metaPhoneNumberId: metaPhoneNumberId ?? existing.metaPhoneNumberId,
        metaAccessToken: accessTokenToStore,
        metaWebhookVerifyToken: webhookVerifyToken,
        updatedAt: now,
      })
      .where(eq(appSettings.tenantId, orgId));
  } else {
    await db.insert(appSettings).values({
      tenantId: orgId,
      metaWabaId: metaWabaId ?? null,
      metaPhoneNumberId: metaPhoneNumberId ?? null,
      metaAccessToken: accessTokenToStore,
      metaWebhookVerifyToken: webhookVerifyToken,
    });
  }

  return NextResponse.json({ ok: true, metaWebhookVerifyToken: webhookVerifyToken });
}
