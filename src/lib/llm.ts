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

import { generateObject } from 'ai';
import type { z } from 'zod';

/** Modelo por defecto (override por env para tiers altos). */
export const LLM_MODEL = process.env.SENTINEL_LLM_MODEL ?? 'deepseek/deepseek-chat';

/**
 * ¿Hay forma de autenticar contra el AI Gateway?
 * - Local/CI: `AI_GATEWAY_API_KEY`.
 * - En Vercel: el OIDC token (`VERCEL_OIDC_TOKEN`) se inyecta solo.
 * Si no hay ninguno, los motores usan su fallback de regex.
 */
export function isLLMEnabled(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

/**
 * Genera un objeto estructurado validado por un schema zod. Devuelve `null`
 * (nunca lanza) si el LLM está deshabilitado o la llamada falla — el llamador
 * debe tener un fallback.
 */
export async function generateStructured<T>(opts: {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  /** Determinismo: 0 por defecto para clasificación estable. */
  temperature?: number;
  model?: string;
}): Promise<T | null> {
  if (!isLLMEnabled()) return null;
  try {
    const { object } = await generateObject({
      model: opts.model ?? LLM_MODEL,
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
