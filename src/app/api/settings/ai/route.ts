import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getTenantAIConfig } from '@/lib/ai-config';

/**
 * Config de IA del tenant — Fase 3: la IA la gestiona la PLATAFORMA por tier.
 *
 * El tenant ya no elige proveedor/modelo/key (el BYOK se eliminó tras el bug de
 * jul-2026: key inválida → fallos silenciosos). GET informa el tier efectivo
 * para que Settings muestre "análisis IA incluido en tu plan"; el modelo
 * concreto nunca se expone al tenant.
 */

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const config = await getTenantAIConfig(orgId);
  return NextResponse.json({
    managedByPlatform: true,
    tier: config.tier,
  });
}

export async function POST() {
  return NextResponse.json(
    {
      error:
        'La configuración de IA ahora la gestiona la plataforma según tu plan. No hay nada que configurar.',
      code: 'ai_managed_by_platform',
    },
    { status: 410 },
  );
}
