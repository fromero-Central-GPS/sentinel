import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { decrypt } from '@/lib/encryption';

export async function POST() {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  if (!row?.ghlApiToken || !row?.ghlLocationId) {
    return NextResponse.json({ error: 'GHL credentials not configured' }, { status: 400 });
  }

  const token = decrypt(row.ghlApiToken);
  const locationId = row.ghlLocationId;

  const res = await fetch(`https://services.leadconnectorhq.com/locations/${locationId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: '2021-07-28',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `GHL API error: ${res.status} ${text}` }, { status: 400 });
  }

  const data = await res.json();
  return NextResponse.json({ ok: true, locationName: data.location?.name ?? data.name ?? 'Unknown' });
}
