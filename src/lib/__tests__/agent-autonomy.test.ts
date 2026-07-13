import { describe, it, expect } from 'vitest';
import {
  getDefaultAutonomy,
  parseAutonomyConfig,
  serializeAutonomyConfig,
} from '../agent-autonomy';

describe('getDefaultAutonomy', () => {
  it('lo ejecutable parte en propose; lo que toca al cliente en off', () => {
    const d = getDefaultAutonomy();
    expect(d.crear_tarea_vendedor).toBe('propose');
    expect(d.mover_a_frio).toBe('propose');
    expect(d.escalar_a_humano).toBe('propose');
    expect(d.crear_nota).toBe('propose');
    expect(d.contactar_cliente).toBe('off');
    expect(d.ultimo_intento).toBe('off');
  });
});

describe('parseAutonomyConfig', () => {
  it('null/corrupto → default', () => {
    expect(parseAutonomyConfig(null)).toEqual(getDefaultAutonomy());
    expect(parseAutonomyConfig('{no json')).toEqual(getDefaultAutonomy());
  });

  it('respeta modos válidos y descarta inválidos', () => {
    const c = parseAutonomyConfig(
      JSON.stringify({ mover_a_frio: 'auto', crear_tarea_vendedor: 'volar' }),
    );
    expect(c.mover_a_frio).toBe('auto');
    expect(c.crear_tarea_vendedor).toBe('propose'); // inválido → default
  });

  it('guardrail: contactar_cliente no se puede habilitar por config', () => {
    const c = parseAutonomyConfig(
      JSON.stringify({ contactar_cliente: 'auto', ultimo_intento: 'propose' }),
    );
    expect(c.contactar_cliente).toBe('off');
    expect(c.ultimo_intento).toBe('off');
  });

  it('roundtrip con serialize', () => {
    const c = getDefaultAutonomy();
    c.mover_a_frio = 'auto';
    expect(parseAutonomyConfig(serializeAutonomyConfig(c))).toEqual(c);
  });
});
