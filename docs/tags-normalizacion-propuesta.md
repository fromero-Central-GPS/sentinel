# Propuesta: Normalización de TAGS de contacto (CentralGPS)

> Estado: propuesta (2026-07-17). Base para que el motor (Radar/LLM) clasifique
> el tenor de la conversación y **mantenga/corrija los tags** automáticamente.

## 1. Diagnóstico del estado actual

La location tiene **~120 tags planos**, mezclando dimensiones distintas y con mucha
suciedad:

- **Duplicados / typos:** `construccion` vs `contruccion`, `maquinaria2-9` (x2),
  `intefraciones` vs `integracion`, `cliente` vs `cliente activo` vs `customer`.
- **Ciclo de vida disperso:** `lead`, `nuevo`, `prospecto`, `calificado`, `cliente`,
  `cliente activo`, `cliente nuevo`, `cliente inactivo`, `no cliente`, `perdido`,
  `customer`, `renovado` — todos sueltos, sin exclusión.
- **~25 variantes de tamaño de flota:** `+50 vehículos`, `1 vehículo`, `2 a 9…`,
  `activos1`, `camiones2-9`, `camionetas10-49`, `buses2-9`, `maquinaria1`… (tamaño y
  tipo de vehículo colapsados en un solo tag cada uno).
- **Basura de sistema:** `couldn't find caller name`, `email-thread-19eb…`,
  `session`, `resume`, `summary`, `rut: 77584021-8`, `sebatest`, `cen-969`.

**Problema de fondo (validado con datos reales):** los tags están **desactualizados**
— Erico Carrasco es cliente pero tiene `prospecto`; Pedro Garrido es cliente en
soporte pero tiene `human handover`. Por eso el Radar no puede *confiar* en los tags;
al contrario, debe **corregirlos**.

## 2. Principio: separar en DIMENSIONES

Un contacto no tiene "un tag": tiene **una posición en cada dimensión**. Cuatro
dimensiones, una sola de ellas exclusiva.

| Dimensión | ¿Exclusiva? | Qué responde |
|---|---|---|
| **A. Ciclo de vida** | **SÍ (1 sola)** | ¿Es lead, prospecto, cliente…? |
| **B. Tipo de conversación** | 1 principal | ¿De qué trata AHORA la conversación? |
| **C. Facetas** (industria, producto, flota) | No (varias) | ¿Qué necesita / qué es? |
| **D. Operación** (workflow IA/asignación) | No | Flags de proceso |

El motor razona sobre A y B (y las corrige); C y D son metadata que se conserva.

---

## 3. Taxonomía canónica

### Dimensión A — Ciclo de vida (EXCLUSIVA: exactamente 1)

Prefijo propuesto `ciclo:` para que sea inconfundible. Reusa los conceptos que ya
existen; la columna "absorbe" lista los tags actuales que se fusionan.

| Canónico | Significado | Absorbe (tags actuales) |
|---|---|---|
| `ciclo:lead` | Contacto nuevo, sin calificar | `lead`, `nuevo`, `lead-correo`, `fb lead` |
| `ciclo:prospecto` | Calificado, venta abierta en curso | `prospecto`, `calificado`, `lead-cotizacion` |
| `ciclo:cliente-activo` | Compró, servicio vigente | `cliente activo`, `cliente`, `customer`, `cliente nuevo`, `renovado` |
| `ciclo:cliente-inactivo` | Fue cliente, pausado/impago recuperable | `cliente inactivo` |
| `ciclo:ex-cliente` | Churn consumado (se fue) | *(nuevo)* |
| `ciclo:perdido` | Nunca compró, venta caída | `perdido`, `no cliente` |
| `ciclo:descartado` | Spam / no aplica / no es venta | `spam` |

**Precedencia (para resolver conflictos):**
`cliente-activo > cliente-inactivo > ex-cliente > prospecto > lead > perdido > descartado`.

### Dimensión B — Tipo de conversación (1 principal, reevaluable en cada interacción)

| Canónico | Significado | Absorbe |
|---|---|---|
| `conv:intencion-compra` | Quiere comprar / cotizar ahora | `cotizar`, `por-cotizar`, `oportunidad-urgente` |
| `conv:soporte` | Cliente con problema técnico | `soporte`, `human handover` (parcial) |
| `conv:postventa` | Admin: factura, renovación, cambio | `renovar mayo 2025`, `renovar junio 2025` |
| `conv:churn` | Quiere anular / retirar el servicio | `churn-risk` |
| `conv:interno` | Empleado / partner, no cliente externo | `interno` |
| `conv:spam` | No es una conversación real | `spam` |

### Dimensión C — Facetas (no exclusivas, se conservan)

**C1. Industria:** `ind:agricola`, `ind:construccion` (merge `contruccion`),
`ind:forestal`, `ind:mineria`, `ind:logistica`, `ind:pasajeros`, `ind:ultima-milla`.

**C2. Producto de interés:** `prod:gps`, `prod:camaras`, `prod:control-accesos`,
`prod:rastreo360`, `prod:supergps`, `prod:vss`, `prod:integracion` (merge
`intefraciones`/`integracion`), `prod:video`, `prod:garmin`.

**C3. Flota — normalizar el caos.** Separar **tamaño** y **tipo** en dos ejes:
- Tamaño: `flota:1`, `flota:2-9`, `flota:10-49`, `flota:50+`
- Tipo: `veh:camion`, `veh:camioneta`, `veh:bus`, `veh:maquinaria`, `veh:auto`

  → deprecar las ~25 variantes (`camiones2-9`, `camionetas10-49`, `activos1`,
  `buses2-9`, `maquinaria1`…), mapeándolas al par (tamaño + tipo).

### Dimensión D — Operación / workflow (no exclusivas)

`op:agente-ia`, `op:ai-enviar-plan`, `op:ai-iniciar-contacto`, `op:ai-plan-aprobado`,
`op:hsm`, `op:stop-bot`, `op:human-handover`, `op:seguimiento-pendiente`,
`op:llamada-pendiente`, `op:asignado-<vendedor>`.

### A eliminar (basura)
`couldn't find caller name`, `email-thread-*`, `seguimiento-email-*`, `session`,
`resume`, `summary`, `rut: *`, `sin email`, `cen-969`, `sebatest`, `sentinel-test`,
`sept 2024`, `aceptado`, `activos1`, `flota-80`, `session`, `demonoshow`/`onboardingnoshow`
(→ mover a `op:no-show`).

---

## 4. Reglas de reconciliación (lo que el motor detecta y corrige)

El motor propone `{ add: [...], remove: [...], motivo }`. Reglas:

1. **Exclusividad de ciclo:** si hay 2+ tags `ciclo:*`, conservar el de mayor
   precedencia y quitar el resto. *(Erico: `prospecto` + señales de cliente → queda
   `cliente-activo`, se quita `prospecto`.)*

2. **Tipo implica ciclo (lo que pediste):**
   - `conv:soporte` ∨ `conv:postventa` ∨ `conv:churn` ⇒ **es cliente** ⇒ ciclo ∈
     {cliente-activo, cliente-inactivo, ex-cliente}. **Quitar** `ciclo:lead`,
     `ciclo:prospecto`, `no cliente`. *(Si hay `soporte`, no puede haber `prospecto`.)*
   - `conv:churn` confirmado ⇒ `ciclo:cliente-inactivo` o `ciclo:ex-cliente`; quitar
     `cliente-activo`.
   - `conv:intencion-compra` + NO cliente ⇒ `ciclo:prospecto` (o `lead` si sin calificar).
   - `conv:interno` ⇒ sin ciclo de venta; **excluir del Radar**.
   - `conv:spam` ⇒ `ciclo:descartado`; quitar todos los `ciclo:*` de venta.

3. **Dedupe/typos:** `contruccion`→`ind:construccion`, `intefraciones`→`prod:integracion`,
   `maquinaria2-9`(dup) unificar, `cliente`/`customer`→`ciclo:cliente-activo`.

4. **Consistencia cliente↔inactivo:** `cliente-activo` y `cliente-inactivo` no coexisten.

---

## 5. Cómo lo aplica el motor (Radar / agente)

1. El **LLM lee la conversación** (o el resumen IA que GHL ya guarda por contacto) y
   determina **A (ciclo)** y **B (tipo)** — el *tenor real*, no el tag viejo.
2. Compara contra los tags actuales del contacto y corre las **reglas de §4**.
3. Emite una propuesta de cambios `{add, remove, motivo, confianza}`:
   - **Alta confianza** (ej. `soporte` sobre un cliente con equipo instalado) →
     puede auto-aplicar (según autonomía del agente, ver `agente-vendedor-arquitectura.md`).
   - **Media** → aparece como **discrepancia** en la UI con botón "Aplicar".
4. **Efecto en el Radar:** solo entran al Radar los contactos con
   `ciclo:{lead|prospecto}` **y** `conv:intencion-compra`. Un `soporte`, `postventa`,
   `churn`, `interno` o `cliente-activo` **NO** es un lead → se saca del Radar y, de
   paso, se le corrige el ciclo.

Esto convierte al Radar en **motor de higiene**: cada vez que pesca (o descarta) una
conversación, deja el contacto correctamente etiquetado.

---

## 6. Plan de migración

1. **Crear** los tags canónicos (`ciclo:*`, `conv:*`, `ind:*`, `prod:*`, `flota:*`,
   `veh:*`, `op:*`).
2. **Mapa de migración** (tabla vieja→nueva de §3) aplicado en lote una vez.
3. **Motor de reconciliación** corre incremental sobre cada conversación clasificada.
4. **Deprecar** los tags viejos/basura tras verificar el lote.

## 7. Decisiones que necesito de ti
- ¿OK con el prefijo por dimensión (`ciclo:`, `conv:`, `ind:`…)? Ordena mucho, pero
  cambia todos los nombres. Alternativa: nombres planos sin prefijo (menos claro).
- ¿Falta algún **tipo de conversación** o **estado de ciclo** propio de CentralGPS
  (ej. `licitacion`, `renovacion`, `upsell`)? Vi tags como `licitacion`,
  `upssell-activo`, `cuenta clave` que podrían ser estados/facetas propias.
- ¿Qué nivel de autonomía para el re-tag (auto alta-confianza vs siempre pedir OK)?
