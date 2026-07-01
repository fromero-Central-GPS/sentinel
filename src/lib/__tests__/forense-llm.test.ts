import { describe, it, expect, beforeEach } from 'vitest';
import { diagnoseLossReasonLLM } from '../forense-llm';
import { isLLMEnabled } from '../llm';
import type { CanonicalMessage } from '../types';

const msg = (direction: 'inbound' | 'outbound', body: string): CanonicalMessage => ({
  id: `${direction}-${body.slice(0, 4)}`,
  direction,
  body,
  messageType: 'TYPE_WHATSAPP',
  dateAdded: '2026-01-01T00:00:00Z',
});

describe('diagnoseLossReasonLLM — fallback seguro', () => {
  beforeEach(() => {
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;
  });

  it('isLLMEnabled es false sin credenciales de gateway', () => {
    expect(isLLMEnabled()).toBe(false);
  });

  it('devuelve null (sin lanzar) cuando el LLM está deshabilitado', async () => {
    const out = await diagnoseLossReasonLLM([msg('inbound', 'está muy caro')]);
    expect(out).toBeNull();
  });

  it('devuelve null si no hay mensajes reales', async () => {
    process.env.AI_GATEWAY_API_KEY = 'test-key'; // habilitado, pero sin contenido
    expect(await diagnoseLossReasonLLM([])).toBeNull();
    expect(
      await diagnoseLossReasonLLM([
        { ...msg('inbound', ''), messageType: 'TYPE_ACTIVITY_OPPORTUNITY' },
      ]),
    ).toBeNull();
  });
});
