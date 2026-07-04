/**
 * Config de IA por tenant (Fase 2 — tiers de IA).
 *
 * El admin del tenant elige tipo/modelo/API key en /settings. Acá se resuelve
 * ese registro a la forma que consume el cliente LLM (`LLMAuth`): modelo efectivo
 * + key BYOK desencriptada. Si el tenant no configuró nada, cae al default de
 * plataforma (modelo `LLM_MODEL` + OIDC).
 */

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { decrypt } from './encryption';
import { LLM_MODEL, pingLLM, type LLMAuth } from './llm';

/** Proveedores/tier soportados y su modelo por defecto en el AI Gateway. */
export const AI_TYPES = {
  deepseek: 'deepseek/deepseek-v3.2',
  anthropic: 'anthropic/claude-sonnet-4.6',
  openai: 'openai/gpt-5.4',
  custom: '',
} as const;
export type AIType = keyof typeof AI_TYPES;

export interface TenantAIConfig extends LLMAuth {
  type: AIType;
  model: string;
}

/**
 * Resuelve la config de IA efectiva del tenant. `model` siempre termina definido
 * (config → default del tipo → LLM_MODEL). `apiKey` desencriptada si existe.
 */
export async function getTenantAIConfig(orgId: string): Promise<TenantAIConfig> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  const type = (row?.aiType as AIType | null) ?? 'deepseek';
  const model = row?.aiModel || AI_TYPES[type] || LLM_MODEL;
  return {
    type,
    model,
    apiKey: row?.aiApiKey ? decrypt(row.aiApiKey) : undefined,
  };
}

export interface WorkingAIConfig {
  /** Config con la que el gateway respondió OK, o null si ninguna funciona. */
  config: TenantAIConfig | null;
  /** true si la key BYOK del tenant falló y se usó el gateway de plataforma. */
  usedFallback: boolean;
  /** Error del ping cuando la config del tenant no funcionó. */
  error?: string;
}

/**
 * Resuelve una config de IA que FUNCIONA, verificándola con un ping antes de
 * gastar un batch de llamadas. Caso real (jul-2026): el tenant guardó una API
 * key inválida en Settings → 25 llamadas fallaban en silencio y el regex se
 * cacheaba como si fuera análisis LLM. Si la BYOK falla, cae al gateway de
 * plataforma (OIDC); si tampoco, devuelve el error real para mostrarlo en UI.
 */
export async function resolveWorkingAIConfig(orgId: string): Promise<WorkingAIConfig> {
  const tenant = await getTenantAIConfig(orgId);
  const ping = await pingLLM(tenant);
  if (ping.ok) return { config: tenant, usedFallback: false };

  if (tenant.apiKey) {
    const platform: TenantAIConfig = { ...tenant, apiKey: undefined };
    const platformPing = await pingLLM(platform);
    if (platformPing.ok) return { config: platform, usedFallback: true, error: ping.error };
  }

  return { config: null, usedFallback: false, error: ping.error };
}
