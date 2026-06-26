import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '@/lib/encryption';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const DAYS_AT_RISK_THRESHOLD = 7;

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  if (!row?.ghlApiToken || !row?.ghlLocationId) {
    return NextResponse.json({ error: 'GHL credentials not configured' }, { status: 400 });
  }

  const token = decrypt(row.ghlApiToken);
  const locationId = row.ghlLocationId;
  const headers = { Authorization: `Bearer ${token}`, Version: GHL_VERSION };

  const res = await fetch(
    `${GHL_BASE}/opportunities/search?location_id=${locationId}&status=open&limit=100`,
    { headers }
  );
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `GHL error: ${res.status} ${text}` }, { status: 502 });
  }

  const data = await res.json();
  const rawOpps: GHLRawOpportunity[] = data.opportunities ?? data.data ?? [];
  const now = Date.now();

  const atRisk = rawOpps
    .map((opp) => {
      const lastActivityMs = opp.lastStageChangeAt
        ? new Date(opp.lastStageChangeAt).getTime()
        : opp.dateAdded
          ? new Date(opp.dateAdded).getTime()
          : now;
      const daysSinceActivity = Math.floor((now - lastActivityMs) / 86_400_000);
      const value = opp.monetaryValue ?? 0;
      const riskScore = daysSinceActivity * (1 + value / 1_000_000);

      return {
        id: opp.id,
        name: opp.name ?? opp.contact?.name ?? 'Desconocido',
        stage: opp.pipelineStage?.name ?? opp.pipelineStageName ?? '',
        daysSinceActivity,
        riskScore: Math.round(riskScore * 100) / 100,
        value,
      };
    })
    .filter((o) => o.daysSinceActivity >= DAYS_AT_RISK_THRESHOLD)
    .sort((a, b) => b.riskScore - a.riskScore);

  return NextResponse.json({
    totalAtRisk: atRisk.length,
    totalValue: atRisk.reduce((s, o) => s + o.value, 0),
    opportunities: atRisk,
  });
}

type GHLRawOpportunity = {
  id: string;
  name?: string;
  contact?: { name?: string };
  monetaryValue?: number;
  pipelineStageName?: string;
  pipelineStage?: { name?: string };
  lastStageChangeAt?: string;
  dateAdded?: string;
};
