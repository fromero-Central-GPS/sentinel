import { describe, expect, it } from 'vitest';
import { canonicalTag, reconcileTags } from '../tag-taxonomy';

describe('canonicalTag', () => {
  it('normaliza alias y typos', () => {
    expect(canonicalTag('Customer')).toBe('cliente activo');
    expect(canonicalTag('churn-risk')).toBe('churn');
    expect(canonicalTag('contruccion')).toBe('construccion');
    expect(canonicalTag('  LEAD ')).toBe('lead');
  });
});

describe('reconcileTags — casos reales (jul-2026)', () => {
  it('Erico: cliente con tag prospecto + conversación de soporte ⇒ corrige a cliente activo', () => {
    const r = reconcileTags(['prospecto', '2 a 9 vehículos', 'stop bot'], {
      tipo: 'soporte',
      esCliente: true,
      confianza: 0.9,
    });
    expect(r.ciclo).toBe('cliente activo');
    expect(r.add).toContain('cliente activo');
    expect(r.add).toContain('soporte');
    expect(r.remove).toContain('prospecto');
    // facetas no se tocan
    expect(r.remove).not.toContain('2 a 9 vehículos');
    expect(r.remove).not.toContain('stop bot');
  });

  it('José Emilio: quiere retirar el demo (churn) ⇒ cliente inactivo', () => {
    const r = reconcileTags(['prospecto'], { tipo: 'churn', esCliente: true, confianza: 0.8 });
    expect(r.ciclo).toBe('cliente inactivo');
    expect(r.add).toEqual(expect.arrayContaining(['cliente inactivo', 'churn']));
    expect(r.remove).toContain('prospecto');
  });

  it('Francisca: empleada (interno) ⇒ sin ciclo de venta', () => {
    const r = reconcileTags(['lead'], { tipo: 'interno', esCliente: false, confianza: 0.9 });
    expect(r.ciclo).toBeNull();
    expect(r.add).toContain('interno');
    expect(r.remove).toContain('lead');
  });

  it('lead nuevo con intención de compra ⇒ conserva lead (sin calificar) + intencion-compra', () => {
    const r = reconcileTags(['lead'], {
      tipo: 'intencion-compra',
      esCliente: false,
      confianza: 0.7,
    });
    expect(r.ciclo).toBe('lead');
    expect(r.add).toContain('intencion-compra');
    expect(r.remove).toEqual([]);
  });

  it('prospecto con intención de compra ⇒ se mantiene prospecto', () => {
    const r = reconcileTags(['prospecto', 'calificado'], {
      tipo: 'intencion-compra',
      esCliente: false,
      confianza: 0.7,
    });
    expect(r.ciclo).toBe('prospecto');
    // `calificado` es alias de prospecto → se reemplaza por el canónico presente
    expect(r.remove).toContain('calificado');
    expect(r.remove).not.toContain('prospecto');
  });

  it('exclusividad: cliente + customer + prospecto ⇒ queda solo `cliente activo`', () => {
    const r = reconcileTags(['cliente', 'customer', 'prospecto'], {
      tipo: 'frio',
      esCliente: false,
      confianza: 0.5,
    });
    expect(r.ciclo).toBe('cliente activo');
    expect(r.remove).toEqual(expect.arrayContaining(['cliente', 'customer', 'prospecto']));
    expect(r.add).toContain('cliente activo');
  });

  it('spam ⇒ descartado y fuera los ciclos de venta', () => {
    const r = reconcileTags(['lead', 'prospecto'], {
      tipo: 'spam',
      esCliente: false,
      confianza: 0.9,
    });
    expect(r.ciclo).toBe('descartado');
    expect(r.remove).toEqual(expect.arrayContaining(['lead', 'prospecto']));
  });

  it('churn-risk viejo se reemplaza por churn canónico', () => {
    const r = reconcileTags(['cliente activo', 'churn-risk'], {
      tipo: 'churn',
      esCliente: true,
      confianza: 0.8,
    });
    expect(r.ciclo).toBe('cliente inactivo');
    expect(r.remove).toEqual(expect.arrayContaining(['cliente activo', 'churn-risk']));
    expect(r.add).toEqual(expect.arrayContaining(['cliente inactivo', 'churn']));
  });

  it('idempotencia: contacto ya correcto ⇒ sin cambios', () => {
    const r = reconcileTags(['cliente activo', 'soporte', 'gps'], {
      tipo: 'soporte',
      esCliente: true,
      confianza: 0.9,
    });
    expect(r.add).toEqual([]);
    expect(r.remove).toEqual([]);
  });
});
