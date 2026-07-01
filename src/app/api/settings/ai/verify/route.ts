import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getTenantAIConfig } from '@/lib/ai-config';
import { pingLLM } from '@/lib/llm';

/** Prueba la config de IA del tenant con una llamada mínima al AI Gateway. */
export async function POST() {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const config = await getTenantAIConfig(orgId);
  const result = await pingLLM(config);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
