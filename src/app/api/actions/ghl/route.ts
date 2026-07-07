import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { decrypt } from '@/lib/encryption';
import { addContactTags, createContactTask } from '@/lib/ghl-client';
import { recordRecommendationEvent } from '@/lib/outcomes';
import type { LossReason } from '@/lib/taxonomy';

/**
 * Acción 1-click Forense → GHL (P1-3).
 *
 * Desde la tabla de recuperables, el equipo puede:
 *  - `tag`: sumar el contacto a una ola de reactivación (tag por ola + tag por
 *    razón de pérdida, para segmentar el mensaje: precio→oferta, sin_seguimiento
 *    →disculpa+humano, competidor→comparativa).
 *  - `task`: crear una tarea de seguimiento en GHL con un guion según la razón.
 *
 * Corre con el token GHL del tenant (mismo patrón que los motores). No usa el
 * MCP: el MCP `prod-ghl-cmp-mcp` fue solo la referencia de payloads.
 */

/** Ola de reactivación vigente (una por día): `reactivation_wave_YYYYMMDD`. */
function currentWaveTag(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `reactivation_wave_${ymd}`;
}

/** Guion de seguimiento segmentado por razón de pérdida. */
const REASON_PLAYBOOK: Record<LossReason, { angle: string; task: string }> = {
  precio: { angle: 'oferta', task: 'Reactivar con oferta/descuento: el cliente objetó precio.' },
  competidor: {
    angle: 'comparativa',
    task: 'Enviar comparativa de ventajas: el cliente evaluó competencia.',
  },
  sin_seguimiento: {
    angle: 'disculpa_humano',
    task: 'Reabrir con disculpa y contacto humano: se perdió por falta de seguimiento.',
  },
  falta_informacion: {
    angle: 'info',
    task: 'Enviar información/demo que faltó para decidir.',
  },
  producto_no_disponible: {
    angle: 'novedad',
    task: 'Avisar si ya cubrimos lo que necesitaba (producto no disponible antes).',
  },
  proceso_complejo: {
    angle: 'simplificar',
    task: 'Ofrecer onboarding asistido: el proceso le resultó complejo.',
  },
  cliente_explorando: {
    angle: 'nurturing',
    task: 'Nurturing suave: solo estaba cotizando, sin intención inmediata.',
  },
  desconocido: { angle: 'reengage', task: 'Reengagement general: razón de pérdida sin determinar.' },
};

type ActionBody = {
  action: 'tag' | 'task';
  contactId: string;
  contactName?: string;
  lossReason?: LossReason;
  /** Oportunidad (ghlId) — para outcome tracking (P2). */
  opportunityId?: string;
  /** Valor del deal al momento de actuar (uplift ponderado por $). */
  value?: number;
};

export async function POST(request: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: ActionBody;
  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body.contactId || (body.action !== 'tag' && body.action !== 'task')) {
    return NextResponse.json(
      { error: 'Se requiere contactId y action ("tag" | "task").' },
      { status: 400 },
    );
  }

  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  if (!row?.ghlApiToken || !row?.ghlLocationId) {
    return NextResponse.json(
      { error: 'GHL no configurado', hint: 'Configura GHL en Settings.' },
      { status: 400 },
    );
  }
  const creds = { token: decrypt(row.ghlApiToken), locationId: row.ghlLocationId };
  const reason: LossReason = body.lossReason ?? 'desconocido';
  const playbook = REASON_PLAYBOOK[reason] ?? REASON_PLAYBOOK.desconocido;

  // Outcome tracking: registra que el equipo actuó sobre esta recomendación.
  // Forense analiza deals perdidos → statusAtEvent 'lost'. dealGhlId prioriza la
  // oportunidad; si no vino, cae al contacto.
  const recordOutcome = (extra: unknown) =>
    recordRecommendationEvent({
      tenantId: orgId,
      dealGhlId: body.opportunityId ?? body.contactId,
      contactId: body.contactId,
      engine: 'forense',
      action: body.action,
      reason,
      statusAtEvent: 'lost',
      valueAtEvent: body.value,
      payload: extra,
    });

  try {
    if (body.action === 'tag') {
      const wave = currentWaveTag();
      const tags = [wave, `reactivation_${playbook.angle}`];
      await addContactTags(creds, body.contactId, tags);
      await recordOutcome({ tags });
      return NextResponse.json({ ok: true, action: 'tag', tags });
    }

    // action === 'task'
    const name = body.contactName ? ` — ${body.contactName}` : '';
    const result = await createContactTask(creds, body.contactId, {
      title: `Reactivar oportunidad perdida${name}`,
      body: playbook.task,
    });
    await recordOutcome({ taskId: result.id });
    return NextResponse.json({ ok: true, action: 'task', taskId: result.id });
  } catch (err) {
    return NextResponse.json(
      { error: 'Error al ejecutar la acción en GHL', detail: String(err) },
      { status: 502 },
    );
  }
}
