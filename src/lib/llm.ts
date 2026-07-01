/**
 * Cliente LLM de Sentinel — Fase 2 (cerebro de los motores).
 *
 * Rutea por **Vercel AI Gateway** usando model strings `"provider/model"`, de modo
 * que cambiar de tier del SaaS = cambiar un string (DeepSeek barato por defecto →
 * Claude para tiers altos) sin tocar código. El cómputo numérico (tiempos,
 * velocity, thresholds) queda SIEMPRE en código; el LLM solo hace clasificación y
 * razonamiento cualitativo sobre texto.
 *
 * Diseño defensivo: si no hay credenciales de gateway o la llamada falla,
 * `generateStructured` devuelve `null` y el motor cae a su heurística de regex.
 * Así producción nunca se rompe por un problema de LLM.
 */

import { generateObject, generateText, createGateway } from 'ai';
import type { z } from 'zod';

/** Config de IA resuelta por tenant (modelo + key BYOK opcional). */
export interface LLMAuth {
  /** Slug del AI Gateway. Si falta, se usa `LLM_MODEL`. */
  model?: string;
  /** AI Gateway API key del tenant (BYOK). Si falta, se usa OIDC/env de plataforma. */
  apiKey?: string;
}

/**
 * Modelo por defecto (override por env `SENTINEL_LLM_MODEL` para tiers altos).
 * `deepseek/deepseek-v3.2`: barato y accesible en el free tier del AI Gateway
 * (validado end-to-end con generateObject). OJO: los slugs usan puntos, no
 * guiones, y `deepseek-chat`/`v4-flash` NO están disponibles en free tier.
 */
export const LLM_MODEL = process.env.SENTINEL_LLM_MODEL ?? 'deepseek/deepseek-v3.2';

/**
 * ¿Hay forma de autenticar contra el AI Gateway?
 * - Key BYOK del tenant (`auth.apiKey`).
 * - Local/CI: `AI_GATEWAY_API_KEY`.
 * - En Vercel: el OIDC token (`VERCEL_OIDC_TOKEN`) se inyecta solo.
 * Si no hay ninguna, los motores usan su fallback de regex.
 */
export function isLLMEnabled(auth?: LLMAuth): boolean {
  return Boolean(auth?.apiKey || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

/**
 * Genera un objeto estructurado validado por un schema zod. Devuelve `null`
 * (nunca lanza) si el LLM está deshabilitado o la llamada falla — el llamador
 * debe tener un fallback.
 *
 * Si `apiKey` viene, se usa un gateway BYOK del tenant; si no, el gateway por
 * defecto (OIDC de plataforma). `model` viene del tier del tenant o del default.
 */
export async function generateStructured<T>(opts: {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  /** Determinismo: 0 por defecto para clasificación estable. */
  temperature?: number;
  model?: string;
  apiKey?: string;
}): Promise<T | null> {
  if (!isLLMEnabled({ apiKey: opts.apiKey })) return null;
  const modelId = opts.model ?? LLM_MODEL;
  try {
    const { object } = await generateObject({
      model: opts.apiKey ? createGateway({ apiKey: opts.apiKey })(modelId) : modelId,
      schema: opts.schema,
      system: opts.system,
      prompt: opts.prompt,
      temperature: opts.temperature ?? 0,
    });
    return object;
  } catch (err) {
    console.error('[LLM] generateObject falló, se usará fallback:', err);
    return null;
  }
}

/**
 * Prueba de conectividad para la UI de settings: hace una llamada mínima con la
 * config del tenant y reporta ok/error real (no silencioso como generateStructured).
 */
export async function pingLLM(
  auth?: LLMAuth,
): Promise<{ ok: boolean; model: string; error?: string }> {
  const modelId = auth?.model ?? LLM_MODEL;
  if (!isLLMEnabled(auth)) {
    return { ok: false, model: modelId, error: 'Sin credenciales de AI Gateway (OIDC o API key).' };
  }
  try {
    await generateText({
      model: auth?.apiKey ? createGateway({ apiKey: auth.apiKey })(modelId) : modelId,
      prompt: 'Responde solo: ok',
      maxOutputTokens: 8,
    });
    return { ok: true, model: modelId };
  } catch (err) {
    return { ok: false, model: modelId, error: err instanceof Error ? err.message : String(err) };
  }
}
