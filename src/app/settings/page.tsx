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
          <button
            onClick={verifyGhl}
            className="rounded border px-4 py-2 text-sm hover:bg-gray-50"
          >
            Verificar conexión
          </button>
          {ghlStatus && <span className="text-sm text-gray-600">{ghlStatus}</span>}
        </div>

        {verifyStatus && (
          <p className={`text-sm ${verifyStatus.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
            {verifyStatus}
          </p>
        )}
      </section>

      {/* Meta / WhatsApp Business Section */}
      <section className="rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold">Meta / WhatsApp Business</h2>

        <div className="space-y-2">
          <label className="block text-sm font-medium">WABA ID (WhatsApp Business Account ID)</label>
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
            placeholder={meta.metaAccessToken ? meta.metaAccessToken : 'Ingresa tu access token permanente'}
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
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Webhook Verify Token</p>
              <p className="mt-1 font-mono text-sm break-all">{meta.metaWebhookVerifyToken}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Webhook URL</p>
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
              <p className="mt-1 text-xs text-gray-500">Registra esta URL en Meta Business Suite → WhatsApp → Webhooks</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
