/**
 * Cliente LLM de Sentinel — Fase 2/3 (cerebro de los motores).
 *
 * Rutea por **Vercel AI Gateway** usando model strings `"provider/model"`. El
 * modelo lo decide la PLATAFORMA según el plan del tenant (ver `ai-config.ts` /
 * `TIER_MODELS`): el tenant elige un tier (Free/Pro/Enterprise), nunca ve qué
 * LLM corre por debajo. No hay keys por tenant: una sola credencial de
 * plataforma (OIDC en Vercel / `AI_GATEWAY_API_KEY` en local-CI) y la
 * atribución por tenant viaja en cada request vía `providerOptions.gateway`
 * (`user` + `tags`), visible en el dashboard del gateway.
 *
 * El cómputo numérico (tiempos, velocity, thresholds) queda SIEMPRE en código;
 * el LLM solo hace clasificación y razonamiento cualitativo sobre texto.
 *
 * Diseño defensivo: si no hay credenciales o la llamada falla,
 * `generateStructured` devuelve `null` y el motor cae a su heurística de regex.
 * (Las rutas verifican credenciales con `pingLLM` ANTES de un batch para no
 * fallar N veces en silencio — lección del bug BYOK de jul-2026.)
 */

import { generateObject, generateText, gateway } from 'ai';
import type { z } from 'zod';

/** Atribución por tenant para el dashboard del AI Gateway. */
export interface LLMAttribution {
  /** ID del tenant (orgId) — habilita gasto y rate-limit por tenant. */
  user?: string;
  /** Etiquetas de costo, ej: ["tenant:org_x", "tier:pro", "engine:forense"]. */
  tags?: string[];
}

/** Config de IA resuelta por tenant (modelo por tier + atribución). */
export interface LLMAuth {
  /** Slug del AI Gateway. Si falta, se usa `LLM_MODEL`. */
  model?: string;
  /** Atribución (user/tags) que viaja al gateway en cada llamada. */
  attribution?: LLMAttribution;
}

/** Tokens consumidos por una llamada (para metering por tenant). */
export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Modelo por defecto (override por env `SENTINEL_LLM_MODEL`).
 * `deepseek/deepseek-v3.2`: barato y accesible en el free tier del AI Gateway
 * (validado end-to-end con generateObject). OJO: los slugs usan puntos, no
 * guiones, y `deepseek-chat`/`v4-flash` NO están disponibles en free tier.
 */
export const LLM_MODEL = process.env.SENTINEL_LLM_MODEL ?? 'deepseek/deepseek-v3.2';

/**
 * ¿Hay credencial de plataforma para el AI Gateway?
 * - Local/CI: `AI_GATEWAY_API_KEY` o `VERCEL_OIDC_TOKEN` (de `vercel env pull`).
 * - En Vercel (`VERCEL=1`): el OIDC se resuelve en RUNTIME vía el request
 *   context de @vercel/oidc — VERCEL_OIDC_TOKEN puede no estar en env, así que
 *   ahí no se bloquea: se intenta la llamada y pingLLM reporta el error real.
 * Si no hay ninguna, los motores usan su fallback de regex.
 */
export function isLLMEnabled(): boolean {
  return Boolean(
    process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL,
  );
}

function gatewayOptions(attribution?: LLMAttribution) {
  return attribution ? { gateway: { ...attribution } } : undefined;
}

/**
 * Genera un objeto estructurado validado por un schema zod. Devuelve `null`
 * (nunca lanza) si el LLM está deshabilitado o la llamada falla — el llamador
 * debe tener un fallback y NUNCA cachear el fallback como si fuera output LLM.
 */
export async function generateStructured<T>(opts: {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  /** Determinismo: 0 por defecto para clasificación estable. */
  temperature?: number;
  model?: string;
  attribution?: LLMAttribution;
  /** Callback con los tokens reales consumidos (metering por tenant). */
  onUsage?: (usage: LLMUsage) => void;
}): Promise<T | null> {
  if (!isLLMEnabled()) return null;
  const modelId = opts.model ?? LLM_MODEL;
  try {
    const { object, usage } = await generateObject({
      model: gateway(modelId),
      schema: opts.schema,
      system: opts.system,
      prompt: opts.prompt,
      temperature: opts.temperature ?? 0,
      providerOptions: gatewayOptions(opts.attribution),
    });
    opts.onUsage?.({
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });
    return object;
  } catch (err) {
    console.error('[LLM] generateObject falló, se usará fallback:', err);
    return null;
  }
}

/**
 * Prueba de conectividad: llamada mínima con la config dada, reporta ok/error
 * real (no silencioso como generateStructured). Las rutas la usan ANTES de un
 * batch para abortar temprano y mostrar el error en la UI.
 */
export async function pingLLM(
  auth?: LLMAuth,
): Promise<{ ok: boolean; model: string; error?: string }> {
  const modelId = auth?.model ?? LLM_MODEL;
  if (!isLLMEnabled()) {
    return { ok: false, model: modelId, error: 'Sin credenciales de AI Gateway (OIDC o API key).' };
  }
  try {
    await generateText({
      model: gateway(modelId),
      prompt: 'Responde solo: ok',
      maxOutputTokens: 8,
      providerOptions: gatewayOptions(auth?.attribution),
    });
    return { ok: true, model: modelId };
  } catch (err) {
    return { ok: false, model: modelId, error: err instanceof Error ? err.message : String(err) };
  }
}
