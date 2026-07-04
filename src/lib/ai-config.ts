/**
 * Config de IA por tenant (Fase 3 — modelo por TIER, gestionado por plataforma).
 *
 * El tenant NUNCA elige proveedor/modelo/key: elige un plan (Free/Pro/
 * Enterprise) y la plataforma decide qué LLM corre por debajo (`TIER_MODELS`).
 * La credencial es única de plataforma (OIDC del proyecto / AI_GATEWAY_API_KEY)
 * y la atribución de gasto por tenant viaja en cada llamada vía
 * `providerOptions.gateway` ({user, tags}) — visible en el dashboard del
 * AI Gateway sin gestionar keys por tenant.
 *
 * Las columnas `aiType`/`aiModel`/`aiApiKey` de appSettings quedaron OBSOLETAS
 * (el BYOK por tenant se eliminó tras el bug de jul-2026: key inválida →
 * fallos silenciosos). No se leen más; se conservan solo para no migrar
 * destructivamente.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { organizations, subscriptions, plans } from '@/db/schema';
import { LLM_MODEL, pingLLM, type LLMAuth, type LLMAttribution } from './llm';

/**
 * Modelo por tier (slug del plan → slug del AI Gateway). Override por env
 * `SENTINEL_LLM_MODEL_<TIER>` (ej: SENTINEL_LLM_MODEL_ENTERPRISE) sin deploy
 * de código. "lite" es alias del futuro rename de free.
 */
export const TIER_MODELS: Record<string, string> = {
  free: 'deepseek/deepseek-v3.2',
  lite: 'deepseek/deepseek-v3.2',
  pro: 'deepseek/deepseek-v3.2',
  enterprise: 'anthropic/claude-sonnet-4.6',
};

export interface TenantAIConfig extends LLMAuth {
  /** Slug del plan del tenant (free/pro/enterprise). */
  tier: string;
  model: string;
  attribution: LLMAttribution;
}

/** Slug del plan activo del tenant ('free' si no tiene suscripción). */
async function getTenantTier(orgId: string): Promise<string> {
  try {
    const [row] = await db
      .select({ slug: plans.slug })
      .from(organizations)
      .innerJoin(subscriptions, eq(subscriptions.organizationId, organizations.id))
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(organizations.clerkOrgId, orgId));
    return row?.slug ?? 'free';
  } catch {
    return 'free';
  }
}

/** Resuelve la config de IA efectiva del tenant según su plan. */
export async function getTenantAIConfig(orgId: string): Promise<TenantAIConfig> {
  const tier = await getTenantTier(orgId);
  const envOverride = process.env[`SENTINEL_LLM_MODEL_${tier.toUpperCase()}`];
  const model = envOverride || TIER_MODELS[tier] || LLM_MODEL;
  return {
    tier,
    model,
    attribution: { user: orgId, tags: [`tenant:${orgId}`, `tier:${tier}`] },
  };
}

export interface WorkingAIConfig {
  /** Config con la que el gateway respondió OK, o null si no hay credenciales. */
  config: TenantAIConfig | null;
  /** Compat: siempre false desde que no existe BYOK por tenant. */
  usedFallback: boolean;
  /** Error del ping cuando el gateway no respondió. */
  error?: string;
}

/**
 * Resuelve una config de IA que FUNCIONA, verificándola con un ping antes de
 * gastar un batch de llamadas (lección del bug BYOK jul-2026: nunca correr N
 * llamadas contra credenciales no verificadas). Si el gateway no responde,
 * devuelve el error real para mostrarlo en la UI.
 */
export async function resolveWorkingAIConfig(orgId: string): Promise<WorkingAIConfig> {
  const config = await getTenantAIConfig(orgId);
  const ping = await pingLLM(config);
  if (ping.ok) return { config, usedFallback: false };
  return { config: null, usedFallback: false, error: ping.error };
}
