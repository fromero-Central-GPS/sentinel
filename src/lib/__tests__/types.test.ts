import { describe, it, expect } from 'vitest';
import { toDeal, toMessage, toMessages } from '../types';
import type { RawOpportunity, RawMessage } from '../ghl-client';

describe('toDeal', () => {
  it('normaliza nombres de pipeline/stage anidados y resuelve contactId con fallbacks', () => {
    const raw: RawOpportunity = {
      id: 'opp1',
      monetaryValue: 500_000,
      pipeline: { name: 'Ventas 2026' },
      pipelineStage: { name: 'Negociación' },
      contact: { id: 'c1', name: 'Acme', companyName: 'Acme SpA' },
    };
    const deal = toDeal(raw, 'open');
    expect(deal.pipelineName).toBe('Ventas 2026');
    expect(deal.pipelineStageName).toBe('Negociación');
    expect(deal.contactId).toBe('c1');
    expect(deal.name).toBe('Acme'); // cae al nombre del contacto
    expect(deal.status).toBe('open');
  });

  it('usa defaultStatus solo si GHL no informa estado', () => {
    expect(toDeal({ id: 'a' }, 'won').status).toBe('won');
    expect(toDeal({ id: 'a', status: 'lost' }, 'won').status).toBe('lost');
  });

  it('cae a contactId/id cuando no hay contacto', () => {
    const deal = toDeal({ id: 'opp2', contactId: 'cc' }, 'open');
    expect(deal.contactId).toBe('cc');
    expect(deal.contact.id).toBe('cc');
    expect(deal.monetaryValue).toBe(0);
  });
});

describe('toMessage', () => {
  it('normaliza body ausente a string vacío y preserva dirección', () => {
    const raw: RawMessage = {
      id: 'm1',
      direction: 'inbound',
      body: '',
      messageType: 'TYPE_WHATSAPP',
      dateAdded: '2026-01-01T00:00:00Z',
    };
    expect(toMessage(raw).body).toBe('');
    expect(toMessage({ ...raw, body: undefined as unknown as string }).body).toBe('');
    expect(toMessages([raw, raw])).toHaveLength(2);
  });
});
