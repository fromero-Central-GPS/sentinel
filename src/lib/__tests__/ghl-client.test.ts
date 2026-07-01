import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchConversationMessages } from '../ghl-client';

const creds = { token: 't', locationId: 'loc' };

function mockFetchJson(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => payload }) as unknown as Response),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchConversationMessages — forma de respuesta de GHL', () => {
  const sample = {
    id: 'm1',
    direction: 'outbound',
    body: 'hola',
    messageType: 'TYPE_WHATSAPP',
    dateAdded: '2026-01-01T00:00:00Z',
  };

  it('parsea la forma anidada real de GHL { messages: { messages: [...] } }', async () => {
    mockFetchJson({ messages: { messages: [sample], nextPage: false } });
    const out = await fetchConversationMessages(creds, 'conv1');
    expect(out).toHaveLength(1);
    expect(out[0].direction).toBe('outbound');
    expect(out[0].body).toBe('hola');
  });

  it('también acepta la forma plana { messages: [...] }', async () => {
    mockFetchJson({ messages: [sample] });
    const out = await fetchConversationMessages(creds, 'conv1');
    expect(out).toHaveLength(1);
  });

  it('devuelve [] si no hay mensajes', async () => {
    mockFetchJson({ messages: { messages: [] } });
    expect(await fetchConversationMessages(creds, 'conv1')).toEqual([]);
  });
});
