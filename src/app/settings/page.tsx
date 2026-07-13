'use client';

import { useEffect, useRef, useState } from 'react';
import { LOSS_REASONS } from '@/lib/taxonomy';

type LostReasonRow = { id: string; name: string; reason?: string; count: number };

type GhlPipeline = { id: string; name: string };

type GhlSettings = {
  ghlApiToken: string | null;
  ghlLocationId: string | null;
  ghlSalesPipelineId: string | null;
  pipelines: GhlPipeline[];
};

type MetaSettings = {
  metaWabaId: string | null;
  metaPhoneNumberId: string | null;
  metaAccessToken: string | null;
  metaWebhookVerifyToken: string | null;
  webhookUrl?: string;
};

type AiSettings = {
  managedByPlatform: boolean;
  tier: string;
};

export default function SettingsPage() {
  const [ghl, setGhl] = useState<GhlSettings>({
    ghlApiToken: null,
    ghlLocationId: null,
    ghlSalesPipelineId: null,
    pipelines: [],
  });
  const [meta, setMeta] = useState<MetaSettings>({
    metaWabaId: null,
    metaPhoneNumberId: null,
    metaAccessToken: null,
    metaWebhookVerifyToken: null,
  });

  const [ghlToken, setGhlToken] = useState('');
  const [ghlLocationId, setGhlLocationId] = useState('');
  const [ghlSalesPipelineId, setGhlSalesPipelineId] = useState('');
  const [metaWabaId, setMetaWabaId] = useState('');
  const [metaPhoneNumberId, setMetaPhoneNumberId] = useState('');
  const [metaAccessToken, setMetaAccessToken] = useState('');

  const [ghlStatus, setGhlStatus] = useState('');
  const [metaStatus, setMetaStatus] = useState('');
  const [verifyStatus, setVerifyStatus] = useState('');
  const [copied, setCopied] = useState(false);

  // AI: gestionada por la plataforma según el plan — el tenant solo la ve informativa.
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [aiVerify, setAiVerify] = useState('');

  // Razones de pérdida GHL (P2): etiquetas por lostReasonId detectado.
  const [lostReasons, setLostReasons] = useState<LostReasonRow[]>([]);
  const [lostReasonStatus, setLostReasonStatus] = useState('');

  // Agente (AG-3): matriz de autonomía por acción + usuario GHL del agente.
  const [agentAutonomy, setAgentAutonomy] = useState<Record<string, string>>({});
  const [agentConfigurable, setAgentConfigurable] = useState<
    Array<{ action: string; label: string }>
  >([]);
  const [agentUserId, setAgentUserId] = useState('');
  const [agentStatus, setAgentStatus] = useState('');

  // Subscription / usage state
  const [subscription, setSubscription] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [changingPlan, setChangingPlan] = useState('');

  const webhookInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/settings/ghl')
      .then((r) => r.json())
      .then((data: GhlSettings) => {
        setGhl(data);
        setGhlToken(data.ghlApiToken ?? '');
        setGhlLocationId(data.ghlLocationId ?? '');
        setGhlSalesPipelineId(data.ghlSalesPipelineId ?? '');
      });

    fetch('/api/settings/meta')
      .then((r) => r.json())
      .then((data: MetaSettings) => {
        setMeta(data);
        setMetaWabaId(data.metaWabaId ?? '');
        setMetaPhoneNumberId(data.metaPhoneNumberId ?? '');
        setMetaAccessToken(data.metaAccessToken ?? '');
      });

    // Load subscription & usage & plans
    fetch('/api/settings/ai')
      .then((r) => r.json())
      .then((data: AiSettings) => setAi(data))
      .catch(() => {});

    fetch('/api/billing/subscription')
      .then((r) => r.json())
      .then(setSubscription)
      .catch(() => {});

    fetch('/api/billing/usage')
      .then((r) => r.json())
      .then((d) => {
        if (d?.usage) setUsage(d);
      })
      .catch(() => {});

    fetch('/api/billing/plans')
      .then((r) => r.json())
      .then((d) => setPlans(d.plans ?? []))
      .catch(() => {});

    fetch('/api/settings/lost-reasons')
      .then((r) => r.json())
      .then((d: { detected?: LostReasonRow[] }) => {
        // name === id significa "sin etiquetar" → input vacío.
        setLostReasons(
          (d.detected ?? []).map((r) => ({ ...r, name: r.name === r.id ? '' : r.name })),
        );
      })
      .catch(() => {});

    fetch('/api/settings/agent')
      .then((r) => r.json())
      .then(
        (d: {
          autonomy?: Record<string, string>;
          agentUserId?: string | null;
          configurable?: Array<{ action: string; label: string }>;
        }) => {
          setAgentAutonomy(d.autonomy ?? {});
          setAgentConfigurable(d.configurable ?? []);
          setAgentUserId(d.agentUserId ?? '');
        },
      )
      .catch(() => {});
  }, []);

  async function saveAgent() {
    setAgentStatus('Guardando…');
    const res = await fetch('/api/settings/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autonomy: agentAutonomy, agentUserId }),
    });
    setAgentStatus(res.ok ? 'Guardado ✓' : 'Error al guardar');
  }

  function updateLostReason(id: string, patch: Partial<LostReasonRow>) {
    setLostReasons((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function saveLostReasons() {
    setLostReasonStatus('Guardando…');
    const map: Record<string, { name: string; reason?: string }> = {};
    for (const r of lostReasons) {
      const name = r.name.trim();
      if (!name) continue;
      map[r.id] = { name, reason: r.reason || undefined };
    }
    const res = await fetch('/api/settings/lost-reasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ map }),
    });
    setLostReasonStatus(res.ok ? 'Guardado ✓' : 'Error al guardar');
  }

  async function saveGhl() {
    setGhlStatus('Guardando…');
    const res = await fetch('/api/settings/ghl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ghlApiToken: ghlToken, ghlLocationId, ghlSalesPipelineId }),
    });
    if (!res.ok) {
      setGhlStatus('Error al guardar');
      return;
    }
    // Reload to get masked token + pipeline list
    const updated: GhlSettings = await fetch('/api/settings/ghl').then((r) => r.json());
    setGhl(updated);
    setGhlToken(updated.ghlApiToken ?? '');
    setGhlLocationId(updated.ghlLocationId ?? '');
    setGhlSalesPipelineId(updated.ghlSalesPipelineId ?? '');
    setGhlStatus('Guardado ✓');
  }

  async function verifyGhl() {
    setVerifyStatus('Verificando…');
    const res = await fetch('/api/settings/ghl/verify', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      setVerifyStatus(`Error: ${data.error}`);
    } else {
      setVerifyStatus(`✓ Conectado: ${data.locationName}`);
    }
  }

  async function saveMeta() {
    setMetaStatus('Guardando…');
    const res = await fetch('/api/settings/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metaWabaId, metaPhoneNumberId, metaAccessToken }),
    });
    if (!res.ok) {
      setMetaStatus('Error al guardar');
      return;
    }
    // Reload to get masked token and verify token
    const updated: MetaSettings = await fetch('/api/settings/meta').then((r) => r.json());
    setMeta(updated);
    setMetaWabaId(updated.metaWabaId ?? '');
    setMetaPhoneNumberId(updated.metaPhoneNumberId ?? '');
    setMetaAccessToken(updated.metaAccessToken ?? '');
    setMetaStatus('Guardado ✓');
  }

  async function verifyAi() {
    setAiVerify('Verificando…');
    const res = await fetch('/api/settings/ai/verify', { method: 'POST' });
    const data = await res.json();
    setAiVerify(res.ok ? '✓ Análisis IA operativo' : `Error: ${data.error}`);
  }

  function copyWebhookUrl() {
    const url = meta.webhookUrl;
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mx-auto max-w-2xl p-8 space-y-10">
      <h1 className="text-2xl font-bold">Configuración de integraciones</h1>

      {/* GHL Section */}
      <section className="rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold">GoHighLevel (GHL)</h2>

        <div className="space-y-2">
          <label className="block text-sm font-medium">API Token</label>
          <input
            type="password"
            value={ghlToken}
            onChange={(e) => setGhlToken(e.target.value)}
            placeholder={ghl.ghlApiToken ? ghl.ghlApiToken : 'Ingresa tu token GHL'}
            className="w-full rounded border px-3 py-2 text-sm font-mono"
          />
          {ghl.ghlApiToken && (
            <p className="text-xs text-gray-500">Token guardado: {ghl.ghlApiToken}</p>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Location ID</label>
          <input
            type="text"
            value={ghlLocationId}
            onChange={(e) => setGhlLocationId(e.target.value)}
            placeholder="Ej: abc123xyz"
            className="w-full rounded border px-3 py-2 text-sm font-mono"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Pipeline de ventas</label>
          <select
            value={ghlSalesPipelineId}
            onChange={(e) => setGhlSalesPipelineId(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          >
            <option value="">Todas las oportunidades (sin filtro)</option>
            {ghl.pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500">
            El digest diario solo considera las oportunidades de este pipeline. Los pipelines
            post-venta (On Boarding, Up Sell…) representan negocios ya ganados y quedan fuera. Guarda
            el token primero para poder elegir.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={saveGhl}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            Guardar
          </button>
          <button onClick={verifyGhl} className="rounded border px-4 py-2 text-sm hover:bg-gray-50">
            Verificar conexión
          </button>
          {ghlStatus && <span className="text-sm text-gray-600">{ghlStatus}</span>}
        </div>

        {verifyStatus && (
          <p
            className={`text-sm ${verifyStatus.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}
          >
            {verifyStatus}
          </p>
        )}
      </section>

      {/* Razones de pérdida (GHL) — P2 */}
      {lostReasons.length > 0 && (
        <section className="rounded-lg border p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Razones de pérdida (GHL)</h2>
            <p className="text-sm text-gray-500">
              GHL no expone el nombre de sus razones de pérdida por API. Nombra cada una y mapéala a
              una categoría de Sentinel para medir el acuerdo con el diagnóstico de la IA en Forense.
            </p>
          </div>
          <div className="space-y-2">
            {lostReasons.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2">
                <span
                  className="w-36 shrink-0 truncate font-mono text-xs text-gray-400"
                  title={r.id}
                >
                  {r.id}
                </span>
                <span className="w-10 shrink-0 text-xs text-gray-500">{r.count}×</span>
                <input
                  value={r.name}
                  onChange={(e) => updateLostReason(r.id, { name: e.target.value })}
                  placeholder="Nombre legible"
                  className="flex-1 min-w-40 rounded border px-2 py-1 text-sm"
                />
                <select
                  value={r.reason ?? ''}
                  onChange={(e) => updateLostReason(r.id, { reason: e.target.value })}
                  className="rounded border px-2 py-1 text-sm"
                >
                  <option value="">— categoría —</option>
                  {LOSS_REASONS.map((lr) => (
                    <option key={lr} value={lr}>
                      {lr}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={saveLostReasons}
              className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-gray-800"
            >
              Guardar
            </button>
            {lostReasonStatus && <span className="text-sm text-gray-600">{lostReasonStatus}</span>}
          </div>
        </section>
      )}

      {/* Agente — matriz de autonomía (AG-3) */}
      {agentConfigurable.length > 0 && (
        <section className="rounded-lg border p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Agente (autonomía)</h2>
            <p className="text-sm text-gray-500">
              Qué puede hacer el agente con cada acción del playbook. <strong>Off</strong>: la
              ignora. <strong>Proponer</strong>: la encola y tú la apruebas con 1-click en Live
              Opp. <strong>Automático</strong>: la ejecuta solo y deja nota [AGENTE]. Contactar al
              cliente por WhatsApp no es configurable todavía.
            </p>
          </div>
          <div className="space-y-2">
            {agentConfigurable.map(({ action, label }) => (
              <div key={action} className="flex items-center gap-3">
                <span className="w-44 text-sm">{label}</span>
                <select
                  value={agentAutonomy[action] ?? 'propose'}
                  onChange={(e) =>
                    setAgentAutonomy((prev) => ({ ...prev, [action]: e.target.value }))
                  }
                  className="rounded border px-2 py-1 text-sm"
                >
                  <option value="off">Off</option>
                  <option value="propose">Proponer</option>
                  <option value="auto">Automático</option>
                </select>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium">
              Usuario GHL del agente (ID, opcional)
            </label>
            <input
              type="text"
              value={agentUserId}
              onChange={(e) => setAgentUserId(e.target.value)}
              placeholder="Ej: IGwHFLCrrd6wXSpE46RY (Valeria)"
              className="w-full rounded border px-3 py-2 text-sm font-mono"
            />
            <p className="text-xs text-gray-400">
              El usuario de GHL que firma las acciones del agente (dueño de contacto en gestión
              del agente).
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={saveAgent}
              className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-gray-800"
            >
              Guardar
            </button>
            {agentStatus && <span className="text-sm text-gray-600">{agentStatus}</span>}
          </div>
        </section>
      )}

      {/* Meta / WhatsApp Business Section */}
      <section className="rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold">Meta / WhatsApp Business</h2>

        <div className="space-y-2">
          <label className="block text-sm font-medium">
            WABA ID (WhatsApp Business Account ID)
          </label>
          <input
            type="text"
            value={metaWabaId}
            onChange={(e) => setMetaWabaId(e.target.value)}
            placeholder="Ej: 123456789012345"
            className="w-full rounded border px-3 py-2 text-sm font-mono"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Phone Number ID</label>
          <input
            type="text"
            value={metaPhoneNumberId}
            onChange={(e) => setMetaPhoneNumberId(e.target.value)}
            placeholder="Ej: 987654321098765"
            className="w-full rounded border px-3 py-2 text-sm font-mono"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Access Token (System User)</label>
          <input
            type="password"
            value={metaAccessToken}
            onChange={(e) => setMetaAccessToken(e.target.value)}
            placeholder={
              meta.metaAccessToken ? meta.metaAccessToken : 'Ingresa tu access token permanente'
            }
            className="w-full rounded border px-3 py-2 text-sm font-mono"
          />
          {meta.metaAccessToken && (
            <p className="text-xs text-gray-500">Token guardado: {meta.metaAccessToken}</p>
          )}
        </div>

        <button
          onClick={saveMeta}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          Guardar
        </button>
        {metaStatus && <span className="ml-3 text-sm text-gray-600">{metaStatus}</span>}

        {/* Webhook info — shown after saving */}
        {meta.metaWebhookVerifyToken && (
          <div className="mt-4 rounded bg-gray-50 p-4 space-y-3 border">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Webhook Verify Token
              </p>
              <p className="mt-1 font-mono text-sm break-all">{meta.metaWebhookVerifyToken}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Webhook URL
              </p>
              <div className="mt-1 flex items-center gap-2">
                <input
                  ref={webhookInputRef}
                  readOnly
                  value={meta.webhookUrl ?? ''}
                  className="flex-1 rounded border bg-white px-3 py-1.5 text-sm font-mono"
                />
                <button
                  onClick={copyWebhookUrl}
                  className="rounded border px-3 py-1.5 text-xs hover:bg-gray-100"
                >
                  {copied ? 'Copiado ✓' : 'Copiar'}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Registra esta URL en Meta Business Suite → WhatsApp → Webhooks
              </p>
            </div>
          </div>
        )}
      </section>

      {/* AI Section — gestionada por la plataforma según el plan */}
      <section className="rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold">Análisis con IA</h2>
        <div className="rounded-xl bg-zinc-50 p-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-zinc-700">
              El análisis IA está <span className="font-semibold">incluido en tu plan</span>
              {ai?.tier ? (
                <span className="ml-1 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 uppercase">
                  {ai.tier}
                </span>
              ) : null}
              . La plataforma gestiona los modelos y credenciales — no necesitas configurar nada.
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              Los planes superiores usan modelos de análisis más avanzados.{' '}
              <a href="/pricing" className="underline">
                Ver planes →
              </a>
            </p>
          </div>
          <button
            onClick={verifyAi}
            className="shrink-0 rounded border px-4 py-2 text-sm hover:bg-gray-50"
          >
            Probar
          </button>
        </div>

        {aiVerify && (
          <p className={`text-sm ${aiVerify.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
            {aiVerify}
          </p>
        )}
      </section>

      {/* Plan & Subscription Section */}
      {subscription?.plan && (
        <section className="rounded-lg border p-6 space-y-4">
          <h2 className="text-lg font-semibold">Plan y uso</h2>

          <div className="rounded-xl bg-zinc-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-700">Plan actual</p>
                <p className="text-2xl font-bold mt-1">{subscription.plan.name}</p>
              </div>
              <a
                href="/pricing"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Cambiar plan
              </a>
            </div>
            {subscription.plan.priceMonthlyClp && subscription.plan.priceMonthlyClp !== '0' && (
              <p className="mt-2 text-sm text-zinc-500">
                ${parseInt(subscription.plan.priceMonthlyClp, 10).toLocaleString('es-CL')}/mes
              </p>
            )}
          </div>

          {/* Usage bar */}
          {usage && (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-zinc-600">Conversaciones este mes</span>
                  <span className="font-mono text-zinc-700">
                    {usage.usage.conversationsAnalyzed} / {usage.limits.maxConversationsPerMonth}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      usage.limits.usagePercent >= 90
                        ? 'bg-red-500'
                        : usage.limits.usagePercent >= 70
                          ? 'bg-amber-400'
                          : 'bg-blue-500'
                    }`}
                    style={{ width: `${Math.min(100, usage.limits.usagePercent)}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center text-sm">
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-xs text-zinc-500">Forense</p>
                  <p className="font-semibold mt-0.5">{usage.usage.forenseRuns}</p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-xs text-zinc-500">Live Opp</p>
                  <p className="font-semibold mt-0.5">{usage.usage.liveOppRuns}</p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-xs text-zinc-500">Won Track</p>
                  <p className="font-semibold mt-0.5">{usage.usage.wonTrackRuns}</p>
                </div>
              </div>
            </div>
          )}

          {/* Subscription status */}
          {subscription.subscription && (
            <div className="text-xs text-zinc-400 space-y-0.5">
              <p>
                Estado:{' '}
                <span className="font-medium capitalize">{subscription.subscription.status}</span>
              </p>
              {subscription.subscription.currentPeriodEnd && (
                <p>
                  Próximo período:{' '}
                  {new Date(subscription.subscription.currentPeriodEnd).toLocaleDateString('es-CL')}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Plan upgrade footer for Free users */}
      {plans.length > 0 && subscription?.plan?.slug === 'free' && (
        <section className="rounded-lg border border-blue-200 bg-blue-50 p-6 space-y-3">
          <h2 className="text-lg font-semibold text-blue-900">¿Necesitas más?</h2>
          <p className="text-sm text-blue-700">
            El plan Pro incluye 5,000 conversaciones/mes y todos los motores de análisis.
          </p>
          <div className="flex gap-3">
            {plans
              .filter((p) => p.slug !== 'free')
              .map((plan) => (
                <button
                  key={plan.id}
                  onClick={async () => {
                    setChangingPlan(plan.slug);
                    try {
                      const res = await fetch('/api/billing/subscription', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ planSlug: plan.slug }),
                      });
                      if (!res.ok) {
                        alert('Error al actualizar');
                        setChangingPlan('');
                        return;
                      }
                      const upd = await fetch('/api/billing/subscription').then((r) => r.json());
                      setSubscription(upd);
                      setChangingPlan('');
                    } catch {
                      alert('Error de conexión');
                      setChangingPlan('');
                    }
                  }}
                  disabled={changingPlan === plan.slug}
                  className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {changingPlan === plan.slug ? 'Actualizando…' : `Upgrade a ${plan.name}`}
                </button>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
