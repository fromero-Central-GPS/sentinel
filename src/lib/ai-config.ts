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
import { LLM_MODEL, type LLMAuth } from './llm';

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
