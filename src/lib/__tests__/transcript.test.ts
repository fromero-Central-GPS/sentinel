import { describe, it, expect } from 'vitest';
import { buildTranscript, cleanEmailBody } from '../transcript';
import type { CanonicalMessage } from '../types';

function msg(
  direction: 'inbound' | 'outbound',
  body: string,
  messageType = 'TYPE_WHATSAPP',
  i = 0,
): CanonicalMessage {
  return {
    id: `m${i}`,
    direction,
    body,
    messageType,
    dateAdded: new Date(2026, 0, 1, 10, i).toISOString(),
  };
}

describe('cleanEmailBody', () => {
  it('corta el hilo citado a partir de "De:"', () => {
    const body = `Hola, decidimos continuar con nuestro proveedor actual.\n\nDe: Francisco Romero <fromero@centralgps.cl>\nEnviado: jueves, 23 de abril\nHola Sebastián, ¿cómo estás?`;
    const out = cleanEmailBody(body);
    expect(out).toContain('proveedor actual');
    expect(out).not.toContain('Enviado');
    expect(out).not.toContain('cómo estás');
  });

  it('corta a partir de "El ... escribió:"', () => {
    const body = `Gracias por la propuesta.\nEl lun, 30 mar 2026 a la(s) 2:24 p.m., Sebastián escribió:\n> texto citado`;
    const out = cleanEmailBody(body);
    expect(out).toBe('Gracias por la propuesta.');
  });

  it('corta en la primera línea citada con ">"', () => {
    const body = `Respuesta nueva.\n> línea citada vieja\n> otra línea`;
    expect(cleanEmailBody(body)).toBe('Respuesta nueva.');
  });

  it('elimina imágenes inline y URLs sueltas', () => {
    const body = `Te confirmo la instalación.\n[https://archivos.com/logo.png]\n[cid:ii_19dbb882]\nhttps://tracking.example.com/x`;
    expect(cleanEmailBody(body)).toBe('Te confirmo la instalación.');
  });

  it('devuelve vacío para body vacío', () => {
    expect(cleanEmailBody('')).toBe('');
  });
});

describe('buildTranscript', () => {
  it('conserva conversaciones cortas completas con etiquetas de rol', () => {
    const messages = [
      msg('inbound', 'Hola, me interesa el GPS', 'TYPE_WHATSAPP', 1),
      msg('outbound', 'Te envío la cotización', 'TYPE_WHATSAPP', 2),
    ];
    const t = buildTranscript(messages);
    expect(t).toBe('[CLIENTE] Hola, me interesa el GPS\n[VENDEDOR] Te envío la cotización');
  });

  it('excluye mensajes de actividad y cuerpos vacíos', () => {
    const messages = [
      msg('inbound', 'Hola', 'TYPE_WHATSAPP', 1),
      msg('outbound', 'Opportunity updated', 'TYPE_ACTIVITY_OPPORTUNITY', 2),
      msg('outbound', '   ', 'TYPE_WHATSAPP', 3),
    ];
    expect(buildTranscript(messages)).toBe('[CLIENTE] Hola');
  });

  it('prioriza el FINAL cuando hay que truncar', () => {
    const filler = Array.from({ length: 50 }, (_, i) =>
      msg('outbound', `Mensaje de relleno número ${i} con bastante texto para ocupar espacio`, 'TYPE_WHATSAPP', i + 1),
    );
    const messages = [
      msg('inbound', 'INICIO: quiero cotizar GPS', 'TYPE_WHATSAPP', 0),
      ...filler,
      msg('inbound', 'FINAL: decidimos continuar con nuestro proveedor actual', 'TYPE_WHATSAPP', 60),
    ];
    const t = buildTranscript(messages, 1500);
    expect(t.length).toBeLessThanOrEqual(1600); // presupuesto + marcador de omisión
    expect(t).toContain('FINAL: decidimos continuar');
    expect(t).toContain('INICIO: quiero cotizar');
    expect(t).toContain('omitidos');
  });

  it('limpia hilos citados de emails dentro del transcript', () => {
    const email = `Decidimos no continuar por costos.\n\nDe: Ventas <v@x.cl>\nHistoria citada enorme`;
    const t = buildTranscript([msg('inbound', email, 'TYPE_EMAIL', 1)]);
    expect(t).toContain('Decidimos no continuar');
    expect(t).not.toContain('Historia citada');
  });
});
