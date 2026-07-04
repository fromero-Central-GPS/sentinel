import { describe, it, expect, beforeEach } from 'vitest';
import { TIER_MODELS } from '../ai-config';
import { isLLMEnabled } from '../llm';

describe('AI por tier (gestionada por plataforma)', () => {
  beforeEach(() => {
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;
  });

  it('cada tier tiene un modelo asignado (el tenant nunca lo ve)', () => {
    expect(TIER_MODELS.free).toBe('deepseek/deepseek-v3.2');
    expect(TIER_MODELS.lite).toBe('deepseek/deepseek-v3.2');
    expect(TIER_MODELS.pro).toBe('deepseek/deepseek-v3.2');
    expect(TIER_MODELS.enterprise).toContain('anthropic/');
  });

  it('sin credenciales de plataforma el LLM queda deshabilitado (fallback regex)', () => {
    expect(isLLMEnabled()).toBe(false);
  });

  it('OIDC de plataforma habilita el LLM', () => {
    process.env.VERCEL_OIDC_TOKEN = 'tok';
    expect(isLLMEnabled()).toBe(true);
  });

  it('AI_GATEWAY_API_KEY de plataforma también habilita', () => {
    process.env.AI_GATEWAY_API_KEY = 'vck_test';
    expect(isLLMEnabled()).toBe(true);
  });
});
