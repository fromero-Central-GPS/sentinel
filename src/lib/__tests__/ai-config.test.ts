import { describe, it, expect, beforeEach } from 'vitest';
import { AI_TYPES } from '../ai-config';
import { isLLMEnabled } from '../llm';

describe('AI tiers config', () => {
  beforeEach(() => {
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;
  });

  it('cada tipo tiene un modelo default (salvo custom, que es libre)', () => {
    expect(AI_TYPES.deepseek).toBe('deepseek/deepseek-v3.2');
    expect(AI_TYPES.anthropic).toContain('anthropic/');
    expect(AI_TYPES.openai).toContain('openai/');
    expect(AI_TYPES.custom).toBe('');
  });

  it('una API key BYOK habilita el LLM aunque no haya OIDC/env', () => {
    expect(isLLMEnabled()).toBe(false);
    expect(isLLMEnabled({ apiKey: 'byok-123' })).toBe(true);
  });

  it('OIDC/env de plataforma también habilita', () => {
    process.env.VERCEL_OIDC_TOKEN = 'tok';
    expect(isLLMEnabled()).toBe(true);
  });
});
