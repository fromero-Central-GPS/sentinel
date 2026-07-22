import { describe, it, expect } from 'vitest';
import { isAIField, renderContactContextForLLM, type ContactContext } from '../contact-context';

describe('isAIField', () => {
  it('marca campos por fieldKey con prefijo ai/ia', () => {
    expect(isAIField({ name: 'Resumen', fieldKey: 'contact.ai_resumen' })).toBe(true);
    expect(isAIField({ name: 'Señal', fieldKey: 'contact.ia_senal' })).toBe(true);
    expect(isAIField({ name: 'Next step', fieldKey: 'contact.ai-next-step' })).toBe(true);
  });

  it('marca campos por nombre con prefijo ai/ia', () => {
    expect(isAIField({ name: 'AI - Resumen', fieldKey: 'contact.resumen' })).toBe(true);
    expect(isAIField({ name: 'IA Señal de compra', fieldKey: 'contact.senal' })).toBe(true);
  });

  it('NO marca campos normales ni falsos positivos (aire, aim...)', () => {
    expect(isAIField({ name: 'Empresa', fieldKey: 'contact.company' })).toBe(false);
    expect(isAIField({ name: 'Aire acondicionado', fieldKey: 'contact.aire' })).toBe(false);
    expect(isAIField({ name: 'Aim', fieldKey: 'contact.aim' })).toBe(false);
  });

  // Regresión: los 7 campos AI reales de CentralGPS (GHL jul-2026) deben matchear.
  it('detecta los campos AI reales de la location', () => {
    const realAiKeys = [
      'contact.ai_summary',
      'contact.ai_resumen_conversacion',
      'contact.ai_estado',
      'contact.ai_siguiente_accion',
      'contact.ai_canal_preferido',
      'contact.ai_ultimo_contacto',
      'contact.ai_intentos',
    ];
    for (const fieldKey of realAiKeys) {
      expect(isAIField({ name: 'x', fieldKey })).toBe(true);
    }
    // Campos vecinos que NO son AI no deben colarse.
    expect(isAIField({ name: 'Adjunte el E-RUT', fieldKey: 'contact.adjunte_el_erut' })).toBe(false);
    expect(isAIField({ name: 'Dirección Comercial', fieldKey: 'contact.direccion_comercial' })).toBe(false);
  });
});

describe('renderContactContextForLLM', () => {
  const aiField = {
    id: '1',
    name: 'AI Resumen',
    fieldKey: 'contact.ai_resumen',
    value: 'Quiere 10 GPS',
    dataType: 'LARGE_TEXT',
    isAI: true,
  };
  const ctx: ContactContext = {
    fields: [
      aiField,
      { id: '2', name: 'Rubro', fieldKey: 'contact.rubro', value: 'Transporte', dataType: 'TEXT', isAI: false },
    ],
    aiFields: [aiField],
    notes: [{ body: 'Llamar el lunes', createdAt: '2026-07-20T10:00:00.000Z' }],
  };

  it('rinde campos AI, otros campos y notas con fecha', () => {
    const out = renderContactContextForLLM(ctx);
    expect(out).toContain('Campos AI del contacto');
    expect(out).toContain('- AI Resumen: Quiere 10 GPS');
    expect(out).toContain('Otros datos del contacto');
    expect(out).toContain('- Rubro: Transporte');
    expect(out).toContain('Notas del contacto');
    expect(out).toContain('[2026-07-20] Llamar el lunes');
  });

  it('devuelve string vacío si no hay nada que aportar', () => {
    expect(renderContactContextForLLM({ fields: [], aiFields: [], notes: [] })).toBe('');
  });
});
