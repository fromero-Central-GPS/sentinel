'use client';

import { useEffect, useRef, useState } from 'react';

type GhlSettings = {
  ghlApiToken: string | null;
  ghlLocationId: string | null;
};

type MetaSettings = {
  metaWabaId: string | null;
  metaPhoneNumberId: string | null;
  metaAccessToken: string | null;
  metaWebhookVerifyToken: string | null;
  webhookUrl?: string;
};

type AiSettings = {
  aiType: string;
  aiModel: string | null;
  aiApiKey: string | null;
  isAdmin: boolean;
  defaults: Record<string, string>;
};

export default function SettingsPage() {
  const [ghl, setGhl] = useState<GhlSettings>({ ghlApiToken: null, ghlLocationId: null });
  const [meta, setMeta] = useState<MetaSettings>({
    metaWabaId: null,
    metaPhoneNumberId: null,
    metaAccessToken: null,
    metaWebhookVerifyToken: null,
  });

  const [ghlToken, setGhlToken] = useState('');
  const [ghlLocationId, setGhlLocationId] = useState('');
  const [metaWabaId, setMetaWabaId] = useState('');
  const [metaPhoneNumberId, setMetaPhoneNumberId] = useState('');
  const [metaAccessToken, setMetaAccessToken] = useState('');

  const [ghlStatus, setGhlStatus] = useState('');
  const [metaStatus, setMetaStatus] = useState('');
  const [verifyStatus, setVerifyStatus] = useState('');
  const [copied, setCopied] = useState(false);

  // AI (tiers) state
  const [ai, setAi] = useState<AiSettings>({
    aiType: 'deepseek',
    aiModel: null,
    aiApiKey: null,
    isAdmin: false,
    defaults: {},
  });
  const [aiType, setAiType] = useState('deepseek');
  const [aiModel, setAiModel] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiStatus, setAiStatus] = useState('');
  const [aiVerify, setAiVerify] = useState('');

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
      .then((data: AiSettings) => {
        setAi(data);
        setAiType(data.aiType ?? 'deepseek');
        setAiModel(data.aiModel ?? '');
        setAiApiKey(data.aiApiKey ?? '');
      })
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
  }, []);

  async function saveGhl() {
    setGhlStatus('Guardando…');
    const res = await fetch('/api/settings/ghl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ghlApiToken: ghlToken, ghlLocationId }),
    });
    if (!res.ok) {
      setGhlStatus('Error al guardar');
      return;
    }
    // Reload to get masked token
    const updated: GhlSettings = await fetch('/api/settings/ghl').then((r) => r.json());
    setGhl(updated);
    setGhlToken(updated.ghlApiToken ?? '');
    setGhlLocationId(updated.ghlLocationId ?? '');
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

  async function saveAi() {
    setAiStatus('Guardando…');
    const res = await fetch('/api/settings/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiType, aiModel, aiApiKey }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setAiStatus(data.error ?? 'Error al guardar');
      return;
    }
    const updated: AiSettings = await fetch('/api/settings/ai').then((r) => r.json());
    setAi(updated);
    setAiType(updated.aiType ?? 'deepseek');
    setAiModel(updated.aiModel ?? '');
    setAiApiKey(updated.aiApiKey ?? '');
    setAiStatus('Guardado ✓');
  }

  async function verifyAi() {
    setAiVerify('Verificando…');
    const res = await fetch('/api/settings/ai/verify', { method: 'POST' });
    const data = await res.json();
    setAiVerify(res.ok ? `✓ Conectado (${data.model})` : `Error: ${data.error}`);
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

      {/* AI (tiers) Section */}
      <section className="rounded-lg border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Inteligencia Artificial (tier)</h2>
          {!ai.isAdmin && (
            <span className="text-xs text-amber-600">Solo el admin del tenant puede editar</span>
          )}
        </div>
        <p className="text-sm text-gray-500">
          Modelo usado por los motores (Forense/Won Track). Si no defines una API key, se usa el
          gateway de la plataforma. Deja el modelo vacío para usar el default del tipo.
        </p>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Tipo (proveedor)</label>
          <select
            value={aiType}
            onChange={(e) => setAiType(e.target.value)}
            disabled={!ai.isAdmin}
            className="w-full rounded border px-3 py-2 text-sm disabled:bg-gray-100"
          >
            {Object.keys(ai.defaults).length > 0
              ? Object.keys(ai.defaults).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))
              : ['deepseek', 'anthropic', 'openai', 'custom'].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Modelo (slug del AI Gateway)</label>
          <input
            type="text"
            value={aiModel}
            onChange={(e) => setAiModel(e.target.value)}
            disabled={!ai.isAdmin}
            placeholder={ai.defaults[aiType] || 'ej: deepseek/deepseek-v3.2'}
            className="w-full rounded border px-3 py-2 text-sm font-mono disabled:bg-gray-100"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">API Key (opcional, BYOK)</label>
          <input
            type="password"
            value={aiApiKey}
            onChange={(e) => setAiApiKey(e.target.value)}
            disabled={!ai.isAdmin}
            placeholder={ai.aiApiKey ? ai.aiApiKey : 'Vacío = gateway de la plataforma (OIDC)'}
            className="w-full rounded border px-3 py-2 text-sm font-mono disabled:bg-gray-100"
          />
          {ai.aiApiKey && <p className="text-xs text-gray-500">Key guardada: {ai.aiApiKey}</p>}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={saveAi}
            disabled={!ai.isAdmin}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Guardar
          </button>
          <button onClick={verifyAi} className="rounded border px-4 py-2 text-sm hover:bg-gray-50">
            Verificar conexión
          </button>
          {aiStatus && <span className="text-sm text-gray-600">{aiStatus}</span>}
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
