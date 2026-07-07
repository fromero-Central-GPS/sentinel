import { describe, it, expect } from 'vitest';
import { classifyIntent, computeSplitFunnel, type ClassifiedDeal } from '../split-funnel';
import type { CanonicalMessage, Deal } from '../types';

// ─── Helpers de fixture ───────────────────────────────────────────────────────

function mkDeal(over: Partial<Deal> = {}): Deal {
  const base: Deal = {
    id: 'd1',
    name: 'Deal',
    status: 'open',
    monetaryValue: 1_000_000,
    pipelineName: 'Ventas',
    pipelineStageName: 'Consulta',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-10T00:00:00Z',
    lastStageChangeAt: '2026-01-10T00:00:00Z',
    contactId: 'c1',
    contact: { id: 'c1', name: 'Cliente' },
  };
  return { ...base, ...over };
}

function inbound(body: string): CanonicalMessage {
  return {
    id: 'm1',
    direction: 'inbound',
    body,
    messageType: 'TYPE_WHATSAPP',
    dateAdded: '2026-01-01T12:00:00Z',
  };
}

// ─── classifyIntent ───────────────────────────────────────────────────────────

describe('classifyIntent', () => {
  it('declarada cuando el primer mensaje pide precio/cotización', () => {
    const r = classifyIntent(mkDeal(), [inbound('Hola, ¿cuánto cuesta el GPS para mi flota?')]);
    expect(r.intent).toBe('declarada');
    expect(r.signal).toBe('message');
  });

  it('declarada cuando pide una demo', () => {
    expect(classifyIntent(mkDeal(), [inbound('Quiero una demo de la plataforma')]).intent).toBe(
      'declarada',
    );
  });

  it('creada cuando el primer mensaje viene de contenido/evento', () => {
    const r = classifyIntent(mkDeal(), [inbound('Hola, descargué su ebook de flotas')]);
    expect(r.intent).toBe('creada');
    expect(r.signal).toBe('message');
  });

  it('declarada gana cuando el mensaje mezcla contenido y compra', () => {
    // "vi su ebook" (creada) + "cuánto cuesta" (declarada) → intención de compra.
    expect(
      classifyIntent(mkDeal(), [inbound('Vi su ebook, ¿cuánto cuesta el plan anual?')]).intent,
    ).toBe('declarada');
  });

  it('usa la atribución como desempate cuando el mensaje es genérico', () => {
    const deal = mkDeal({ attributions: [{ utmSessionSource: 'ebook-flotas', isFirst: true }] });
    const r = classifyIntent(deal, [inbound('Hola, buenas tardes')]);
    expect(r.intent).toBe('creada');
    expect(r.signal).toBe('attribution');
  });

  it('atribución de alta intención (referral) → declarada', () => {
    const deal = mkDeal({ attributions: [{ medium: 'referral', isFirst: true }] });
    expect(classifyIntent(deal, [inbound('Hola, buenas tardes')]).intent).toBe('declarada');
  });

  it('desconocida sin señal en mensaje ni atribución', () => {
    const r = classifyIntent(mkDeal(), [inbound('Hola')]);
    expect(r.intent).toBe('desconocida');
    expect(r.signal).toBe('none');
  });

  it('ignora mensajes outbound y de actividad del sistema al buscar el primer inbound', () => {
    const msgs: CanonicalMessage[] = [
      {
        id: 'a',
        direction: 'outbound',
        body: '¿cuánto cuesta?',
        messageType: 'TYPE_WHATSAPP',
        dateAdded: '2026-01-01T10:00:00Z',
      },
      {
        id: 'b',
        direction: 'inbound',
        body: 'evento feria transporte',
        messageType: 'TYPE_ACTIVITY_OPPORTUNITY',
        dateAdded: '2026-01-01T11:00:00Z',
      },
      inbound('Descargué la guía de mantención'),
    ];
    // El único inbound real menciona contenido → creada (no toma el outbound).
    expect(classifyIntent(mkDeal(), msgs).intent).toBe('creada');
  });

  it('toma el PRIMER inbound por fecha, no por orden del array', () => {
    const later = {
      ...inbound('descargué el ebook'),
      id: 'later',
      dateAdded: '2026-01-02T12:00:00Z',
    };
    const earlier = {
      ...inbound('¿me pasas el precio?'),
      id: 'early',
      dateAdded: '2026-01-01T09:00:00Z',
    };
    expect(classifyIntent(mkDeal(), [later, earlier]).intent).toBe('declarada');
  });
});

// ─── computeSplitFunnel ───────────────────────────────────────────────────────

describe('computeSplitFunnel', () => {
  it('agrupa por bucket y calcula conversión won/(won+lost)', () => {
    const classified: ClassifiedDeal[] = [
      { deal: mkDeal({ id: '1', status: 'won' }), intent: 'declarada' },
      { deal: mkDeal({ id: '2', status: 'won' }), intent: 'declarada' },
      { deal: mkDeal({ id: '3', status: 'lost' }), intent: 'declarada' },
      { deal: mkDeal({ id: '4', status: 'open' }), intent: 'declarada' },
      { deal: mkDeal({ id: '5', status: 'won' }), intent: 'creada' },
      { deal: mkDeal({ id: '6', status: 'lost' }), intent: 'creada' },
      { deal: mkDeal({ id: '7', status: 'lost' }), intent: 'creada' },
    ];
    const res = computeSplitFunnel(classified);
    const dec = res.buckets.find((b) => b.bucket === 'declarada')!;
    const cre = res.buckets.find((b) => b.bucket === 'creada')!;
    // declarada: 2 won / (2 won + 1 lost) = 0.666…
    expect(dec.conversionRate).toBeCloseTo(2 / 3, 5);
    expect(dec.open).toBe(1);
    // creada: 1 won / 3 decididos = 0.333…
    expect(cre.conversionRate).toBeCloseTo(1 / 3, 5);
    expect(res.totalDeals).toBe(7);
  });

  it('calcula ciclo y ticket solo sobre los ganados', () => {
    const classified: ClassifiedDeal[] = [
      {
        deal: mkDeal({
          id: '1',
          status: 'won',
          monetaryValue: 2_000_000,
          createdAt: '2026-01-01T00:00:00Z',
          lastStageChangeAt: '2026-01-11T00:00:00Z', // 10 días
        }),
        intent: 'declarada',
      },
      {
        // Un perdido no debe contaminar el ciclo ni el ticket promedio.
        deal: mkDeal({ id: '2', status: 'lost', monetaryValue: 99_000_000 }),
        intent: 'declarada',
      },
    ];
    const dec = computeSplitFunnel(classified).buckets[0];
    expect(dec.avgCycleDays).toBe(10);
    expect(dec.avgTicket).toBe(2_000_000);
    expect(dec.wonValue).toBe(2_000_000);
  });

  it('omite buckets vacíos y calcula el % clasificado', () => {
    const classified: ClassifiedDeal[] = [
      { deal: mkDeal({ id: '1', status: 'won' }), intent: 'declarada' },
      { deal: mkDeal({ id: '2', status: 'open' }), intent: 'desconocida' },
    ];
    const res = computeSplitFunnel(classified);
    expect(res.buckets.map((b) => b.bucket)).toEqual(['declarada', 'desconocida']);
    expect(res.classifiedPct).toBe(50);
  });

  it('el insight reporta el ratio de conversión declarada vs creada', () => {
    const classified: ClassifiedDeal[] = [
      // declarada: 4 won / 5 decididos = 0.8
      ...Array.from({ length: 4 }, (_, i) => ({
        deal: mkDeal({ id: `dw${i}`, status: 'won' as const }),
        intent: 'declarada' as const,
      })),
      { deal: mkDeal({ id: 'dl', status: 'lost' }), intent: 'declarada' },
      // creada: 1 won / 5 decididos = 0.2
      { deal: mkDeal({ id: 'cw', status: 'won' }), intent: 'creada' },
      ...Array.from({ length: 4 }, (_, i) => ({
        deal: mkDeal({ id: `cl${i}`, status: 'lost' as const }),
        intent: 'creada' as const,
      })),
    ];
    const res = computeSplitFunnel(classified);
    // 0.8 / 0.2 = 4×
    expect(res.insight.conversionRatio).toBe(4);
    expect(res.insight.message).toContain('4×');
  });

  it('insight sin comparación cuando falta una de las dos cohortes', () => {
    const res = computeSplitFunnel([{ deal: mkDeal({ status: 'won' }), intent: 'declarada' }]);
    expect(res.insight.conversionRatio).toBeNull();
  });
});
