# Plantillas HSM del agente (Valeria) — diseño

> Creado: 2026-07-13. Set de plantillas WhatsApp para las acciones del
> playbook que tocan al cliente (AG-4 / prototipo). Se crean a mano en GHL
> (Settings → WhatsApp → Templates) porque no hay API pública para crearlas;
> este doc es la fuente de verdad del contenido y su mapeo a acciones.

## Principios (de la evidencia del 12-13 jul)

1. **Categoría Utility, nunca Marketing.** Las Marketing chocan con los caps
   por usuario y el experimento de Meta (error 130472 comprobado). Para
   calificar como Utility el texto debe referirse a una gestión existente
   del cliente (su consulta, su cotización, su demo) — no promocionar.
2. **El único objetivo del HSM es conseguir respuesta.** Solo la respuesta
   del cliente abre la ventana de 24h (validado — la plantilla entregada NO
   la abre). Por eso TODAS llevan botones de respuesta rápida: un tap del
   cliente abre la conversación.
3. **Pocas variables.** Máximo 2 por plantilla ({{1}} casi siempre el nombre
   del contacto). Menos fricción de aprobación en Meta y menos errores de
   placeholders.
4. **Idioma `es`.** El `lang` del payload debe calzar exacto o Meta rechaza
   (#132001 comprobado).
5. **Firma humana del equipo.** El agente opera como "Valeria de Central
   GPS"; transparente y consistente con el Contact Owner (los envíos quedan
   firmados por el usuario Valeria).

## Mapeo acción del playbook → plantilla

| Acción / momento (ronda) | Plantilla | Variables |
|---|---|---|
| `contactar_cliente` — lead nuevo sin primer contacto (R4) | `valeria_primer_contacto` | {{1}} nombre |
| `contactar_cliente` — seguimiento intentos 2-3 (R4) | `valeria_seguimiento_consulta` | {{1}} nombre |
| `ultimo_intento` (R4) | `valeria_ultimo_intento` | {{1}} nombre |
| `contactar_cliente` — cotización sin respuesta (R3/AG-4) | `valeria_seguimiento_cotizacion` | {{1}} nombre |
| `contactar_cliente` — demo <7d, activación (R1) | `valeria_demo_activacion` | {{1}} nombre |
| `contactar_cliente` — demo 7-14d, uso/retención (R1) | `valeria_demo_uso` | {{1}} nombre |

`seguimiento_recibidos` (existente, sin variables) queda como fallback
genérico mientras se aprueban estas.

## Las plantillas

Todas: categoría **Utility**, idioma **es**, botones de respuesta rápida
(quick reply). Texto en español neutro.

### 1. `valeria_primer_contacto`

> Hola {{1}}, soy Valeria de Central GPS. Recibimos tu consulta por rastreo
> GPS y quiero ayudarte a encontrar el plan adecuado para tu flota.
> ¿Conversamos por aquí?

Botones: `Sí, hablemos` · `Prefiero una llamada` · `No por ahora`

### 2. `valeria_seguimiento_consulta`

> Hola {{1}}, te escribo de Central GPS por la consulta que nos dejaste
> sobre rastreo GPS. Quedó pendiente avanzar con tu solicitud:
> ¿sigues buscando una solución para tus vehículos?

Botones: `Sí, me interesa` · `Más adelante` · `Ya no lo necesito`

### 3. `valeria_ultimo_intento`

> Hola {{1}}, intentamos contactarte por tu consulta de GPS sin éxito.
> Este es nuestro último mensaje por este medio: si aún te interesa,
> responde y retomamos de inmediato; si no, cerraremos tu solicitud.

Botones: `Retomar` · `Cerrar solicitud`

### 4. `valeria_seguimiento_cotizacion`

> Hola {{1}}, te enviamos la cotización de Central GPS que solicitaste y
> queremos saber si pudiste revisarla. ¿Tienes dudas sobre los planes o la
> instalación?

Botones: `Tengo dudas` · `Quiero avanzar` · `Necesito más tiempo`

### 5. `valeria_demo_activacion`

> Hola {{1}}, ya está activa tu demo de Central GPS. ¿Pudiste ingresar a la
> plataforma? Si necesitas ayuda con el acceso o con la configuración de
> alertas, te apoyo por aquí.

Botones: `Todo bien` · `Necesito ayuda`

### 6. `valeria_demo_uso`

> Hola {{1}}, ¿cómo va tu experiencia con la plataforma de Central GPS?
> Puedo ayudarte a sacarle más provecho: reportes, alertas y geocercas.
> ¿Te muestro cómo?

Botones: `Sí, muéstrame` · `Tengo dudas` · `Todo bien`

## Payload de envío (probado end-to-end 12-jul)

```json
{
  "type": "WhatsApp",
  "contactId": "<contactId>",
  "message": "<texto ya resuelto, obligatorio como fallback>",
  "MessageType": 19,
  "whatsapp": {
    "type": "template",
    "template": { "name": "valeria_seguimiento_consulta", "lang": "es" },
    "placeholders": { "header": [], "body": ["<nombre>"], "buttons": [] },
    "fromNumberId": "placeholder",
    "toNumber": "<+569XXXXXXXX>"
  }
}
```

- `placeholders.body` en el orden de las variables; vacío si no hay.
- Los botones quick-reply no llevan placeholder (van vacíos en `buttons`).
- La atribución del mensaje sigue al **Contact Owner** → asignar el contacto
  a Valeria antes de enviar.

## Flujo de creación y verificación

1. Crear en GHL (Settings → WhatsApp → Templates), categoría Utility,
   idioma es, con los botones. Meta suele aprobar en minutos-horas.
2. Por cada plantilla aprobada: test de envío por API al número de prueba
   (+56 9 7511 1485) verificando entrega y renderizado de variables.
3. Registrar el nombre exacto aprobado aquí (si Meta fuerza cambios).

### Estado (2026-07-13): APROBADAS y PROBADAS ✓

Las 6 plantillas quedaron aprobadas con estos mismos nombres e idioma `es`.
**Meta las recategorizó a Marketing** (no aceptó Utility para textos de
seguimiento comercial); funcionan igual, con dos consecuencias operativas:

- Aplican los **caps de frecuencia marketing por usuario** de Meta y el
  experimento del ~1% (error 130472) — un envío puede no entregarse sin que
  sea culpa nuestra. El agente debe tratar `failed` con 130472/131049 como
  "canal no disponible" (cambiar canal / crear tarea), no como error.
- Precio por mensaje de categoría marketing.

Test por API (2026-07-13, al número de prueba, vía PIT de Valeria): las 6
enviadas y aceptadas — `delivered`/`read` sin errores de nombre (#132001),
idioma ni frecuencia. La variable {{1}} renderizó el nombre correctamente.

## Interpretación de los botones (para el playbook)

La respuesta por botón es señal estructurada gratis:

- `No por ahora` / `Más adelante` → `mover_a_frio` con nota (reactivable).
- `Ya no lo necesito` / `Cerrar solicitud` → proponer cerrar como perdido
  (con lostReason) — decisión del vendedor en AG-2.
- `Prefiero una llamada` → `crear_tarea_vendedor` inmediata (llamar).
- `Sí, hablemos` / `Tengo dudas` / `Necesito ayuda` → abre ventana:
  continúa el humano (hoy) o el Managed Agent (piloto).
- `Quiero avanzar` → `escalar_a_humano` prioritario (deal caliente).
