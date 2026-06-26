import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '@/lib/encryption';
import { enforceMotorAccess, enforceConversationLimit, incrementUsage } from '@/lib/plan-enforcement';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const CONVERSION_THRESHOLD = 0.20;
const PERIOD_DAYS = 30;

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  if (!row?.ghlApiToken || !row?.ghlLocationId) {
    return NextResponse.json({ error: 'GHL credentials not configured' }, { status: 400 });
  }

  // Plan enforcement
  const enforcement = await enforceMotorAccess('wonTrack');
  if (enforcement.blocked) return enforcement.response!;

  const token = decrypt(row.ghlApiToken);
  const locationId = row.ghlLocationId;
  const headers = { Authorization: `Bearer ${token}`, Version: GHL_VERSION };

  const since = new Date(Date.now() - PERIOD_DAYS * 86_400_000).toISOString();

  const [wonRes, totalRes] = await Promise.all([
    fetch(`${GHL_BASE}/opportunities/search?location_id=${locationId}&status=won&startAfter=${since}&limit=100`, { headers }),
    fetch(`${GHL_BASE}/opportunities/search?location_id=${locationId}&startAfter=${since}&limit=100`, { headers }),
  ]);

  if (!wonRes.ok || !totalRes.ok) {
    const text = await (wonRes.ok ? totalRes : wonRes).text();
    return NextResponse.json({ error: `GHL error: ${text}` }, { status: 502 });
  }

  const [wonData, totalData] = await Promise.all([wonRes.json(), totalRes.json()]);
  const wonOpps: GHLOpp[] = wonData.opportunities ?? wonData.data ?? [];
  const totalOpps: GHLOpp[] = totalData.opportunities ?? totalData.data ?? [];

  // Check conversation limit before processing
  const limitCheck = await enforceConversationLimit(totalOpps.length);
  if (limitCheck.blocked) return limitCheck.response!;

  const won = wonOpps.length;
  const total = totalOpps.length;
  const conversionRate = total > 0 ? won / total : 0;

  const avgTicket =
    won > 0 ? Math.round(wonOpps.reduce((s, o) => s + (o.monetaryValue ?? 0), 0) / won) : 0;

  const avgCycleDays =
    won > 0
      ? Math.round(
          wonOpps.reduce((s, o) => {
            if (!o.createdAt || !o.closedAt) return s;
            const days =
              (new Date(o.closedAt).getTime() - new Date(o.createdAt).getTime()) / 86_400_000;
            return s + days;
          }, 0) / won
        )
      : 0;

  const alerts: { type: string; message: string }[] = [];
  if (conversionRate < CONVERSION_THRESHOLD) {
    alerts.push({
      type: 'warning',
      message: `Tasa de conversión (${(conversionRate * 100).toFixed(1)}%) por debajo del umbral de ${CONVERSION_THRESHOLD * 100}%.`,
    });
  }

  // Track usage
  await incrementUsage('wonTrack', totalOpps.length);

  return NextResponse.json({
    period: '30d',
    won,
    total,
    conversionRate: parseFloat(conversionRate.toFixed(4)),
    avgTicket,
    avgCycleDays,
    alerts,
  });
}

type GHLOpp = {
  monetaryValue?: number;
  createdAt?: string;
  closedAt?: string;
};
