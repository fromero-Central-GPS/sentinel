'use client';

import { useEffect, useState } from 'react';

type Lead = {
  id: string;
  conversationId: string;
  contactId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  lastMessageSnippet: string | null;
  lastMessageDirection: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  ownerName: string | null;
  buyIntent: boolean;
  intentSignals: string[];
  status: string;
  llmTipo: string | null;
  llmMotivo: string | null;
  llmConfianza: number | null;
};

type RadarData = {
  leads: Lead[];
  total: number;
  /** Base del CRM del tenant (dominio whitelabel) para deep-links. */
  ghlBase?: string | null;
  ghlLocationId?: string | null;
  error?: string;
};

/** "hace 3h" / "hace 12d" desde un ISO. */
function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `hace ${hours}h`;
  return `hace ${Math.round(hours / 24)}d`;
}

/**
 * Deep-link a la conversación en el CRM (GHL): el vendedor responde desde el
 * inbox con todo el contexto, no desde su WhatsApp personal.
 */
function ghlConversationLink(data: RadarData | null, conversationId: string): string | null {
  if (!data?.ghlBase || !data?.ghlLocationId) return null;
  // Formato real (verificado por Francisco):
  // https://app.supersonics.one/v2/location/{loc}/conversations/conversations/{conv}
  return `${data.ghlBase}/v2/location/${data.ghlLocationId}/conversations/conversations/${conversationId}`;
}

export default function RadarPage() {
  const [data, setData] = useState<RadarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

  function load() {
    setLoading(true);
    setError(null);
    fetch('/api/engines/radar')
      .then((r) => r.json())
      .then((d: RadarData) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const r = await fetch('/api/engines/radar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh' }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error ?? 'Error al actualizar');
      setData({ leads: d.leads, total: d.total, ghlBase: d.ghlBase, ghlLocationId: d.ghlLocationId });
      setOwnerFilter('all');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function act(lead: Lead, action: 'create_opportunity' | 'dismiss') {
    if (busy) return;
    setBusy(lead.id);
    try {
      const r = await fetch('/api/engines/radar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          conversationId: lead.conversationId,
          contactId: lead.contactId,
          contactName: lead.contactName,
        }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.detail ? `${d.error} — ${d.detail}` : d.error);
      const msg =
        action === 'create_opportunity'
          ? `Oportunidad creada en GHL${d.stage ? ` (etapa: ${d.stage})` : ''}.`
          : 'Descartada.';
      setResult((p) => ({ ...p, [lead.id]: { ok: true, msg } }));
      // Sacar el lead gestionado de la lista.
      setData((prev) =>
        prev ? { ...prev, leads: prev.leads.filter((l) => l.id !== lead.id) } : prev,
      );
    } catch (e) {
      setResult((p) => ({
        ...p,
        [lead.id]: { ok: false, msg: e instanceof Error ? e.message : String(e) },
      }));
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="text-sm text-zinc-500 animate-pulse">Cargando conversaciones…</div>
      </div>
    );
  }

  if (error && !data) {
    const isNoCredentials = /not configured|no configurado/i.test(error);
    return (
      <div className="p-8 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Radar</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center space-y-3">
          <p className="font-semibold text-amber-800">
            {isNoCredentials ? 'Credenciales GHL no configuradas' : 'Error al cargar datos'}
          </p>
          <p className="text-sm text-amber-700">
            {isNoCredentials
              ? 'Configura tu API Token y Location ID de GHL para activar este motor.'
              : error}
          </p>
          <a
            href="/settings"
            className="inline-block mt-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800"
          >
            Ir a Settings →
          </a>
        </div>
      </div>
    );
  }

  const all = data?.leads ?? [];
  const countByOwner = new Map<string, number>();
  let noOwnerCount = 0;
  for (const l of all) {
    if (l.ownerName) countByOwner.set(l.ownerName, (countByOwner.get(l.ownerName) ?? 0) + 1);
    else noOwnerCount++;
  }
  const owners = Array.from(countByOwner.keys()).sort((a, b) => a.localeCompare(b, 'es'));
  const leads =
    ownerFilter === 'all'
      ? all
      : ownerFilter === '__none__'
        ? all.filter((l) => !l.ownerName)
        : all.filter((l) => l.ownerName === ownerFilter);

  const buyCount = leads.filter((l) => l.buyIntent).length;
  const waitingCount = leads.filter((l) => l.unreadCount > 0).length;

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Radar</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Conversaciones con intención de compra sin oportunidad creada
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="text-xs px-3 py-1.5 rounded-full border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50"
        >
          {refreshing ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      {/* Filtro por vendedor */}
      <div className="flex items-center gap-2">
        <label
          htmlFor="owner-filter"
          className="text-xs font-medium text-zinc-500 uppercase tracking-wide"
        >
          Vendedor
        </label>
        <select
          id="owner-filter"
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          className="text-sm rounded-lg border border-zinc-200 bg-white px-3 py-1.5 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        >
          <option value="all">Todos ({all.length})</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              {o} ({countByOwner.get(o)})
            </option>
          ))}
          {noOwnerCount > 0 && <option value="__none__">Sin dueño ({noOwnerCount})</option>}
        </select>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Leads</p>
          <p className="mt-2 text-3xl font-bold text-indigo-600">{leads.length}</p>
          <p className="mt-1 text-xs text-zinc-500">conversaciones sin oportunidad</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
            Intención de compra
          </p>
          <p className="mt-2 text-3xl font-bold text-emerald-600">{buyCount}</p>
          <p className="mt-1 text-xs text-zinc-500">señal de compra detectada</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Sin responder</p>
          <p className="mt-2 text-3xl font-bold text-red-600">{waitingCount}</p>
          <p className="mt-1 text-xs text-zinc-500">con mensajes del cliente sin leer</p>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-12 flex flex-col items-center text-center">
          <p className="text-green-600 font-semibold text-lg">Sin leads pendientes</p>
          <p className="text-sm text-zinc-500 mt-1">
            {all.length === 0
              ? 'Aún no hay conversaciones clasificadas. Prueba "Actualizar" para escanear ahora.'
              : 'Este vendedor no tiene conversaciones sin registrar.'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700">Conversaciones ({leads.length})</h2>
            <p className="text-xs text-zinc-400">Intención → sin leer → recientes</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50">
                  <th className="py-2 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Contacto
                  </th>
                  <th className="py-2 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Último mensaje
                  </th>
                  <th className="py-2 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Señal
                  </th>
                  <th className="py-2 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Sin leer
                  </th>
                  <th className="py-2 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Dueño
                  </th>
                  <th className="py-2 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wide"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {leads.map((lead) => {
                  const ghlLink = ghlConversationLink(data, lead.conversationId);
                  const res = result[lead.id];
                  return (
                    <tr key={lead.id} className="hover:bg-zinc-50 align-top">
                      <td className="py-3 px-4">
                        <div className="text-sm font-medium text-zinc-900">
                          {lead.contactName || 'Sin nombre'}
                        </div>
                        {lead.phone && (
                          <div className="text-xs text-zinc-400 font-mono">{lead.phone}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 max-w-[24rem]">
                        <div className="text-sm text-zinc-700 truncate" title={lead.lastMessageSnippet ?? ''}>
                          {lead.lastMessageDirection === 'inbound' ? '↙ ' : '↗ '}
                          {lead.lastMessageSnippet || '—'}
                        </div>
                        <div className="text-xs text-zinc-400">{timeAgo(lead.lastMessageAt)}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          {lead.buyIntent && (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                              compra
                            </span>
                          )}
                          {lead.llmTipo === 'intencion-compra' && (
                            <span
                              className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200"
                              title={lead.llmMotivo ?? undefined}
                            >
                              ✓ IA
                            </span>
                          )}
                        </div>
                        {lead.llmMotivo ? (
                          <div
                            className="text-[11px] text-zinc-400 mt-0.5 max-w-[14rem] truncate"
                            title={lead.llmMotivo}
                          >
                            {lead.llmMotivo}
                          </div>
                        ) : (
                          lead.intentSignals.length > 0 && (
                            <div className="text-[11px] text-zinc-400 mt-0.5">
                              {lead.intentSignals.map((s) => s.replaceAll('_', ' ')).join(' · ')}
                            </div>
                          )
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm font-mono text-zinc-700">
                        {lead.unreadCount > 0 ? (
                          <span className="text-red-600 font-semibold">{lead.unreadCount}</span>
                        ) : (
                          <span className="text-zinc-400">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm text-zinc-500">{lead.ownerName || '—'}</td>
                      <td className="py-3 px-4">
                        {res ? (
                          <span
                            className={`text-xs ${res.ok ? 'text-green-700' : 'text-red-600'}`}
                          >
                            {res.msg}
                          </span>
                        ) : (
                          <div className="flex items-center gap-2 justify-end">
                            {ghlLink && (
                              <a
                                href={ghlLink}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs px-2 py-1 rounded-lg border border-zinc-200 hover:bg-zinc-50"
                                onClick={(e) => e.stopPropagation()}
                              >
                                Abrir en GHL
                              </a>
                            )}
                            <button
                              onClick={() => act(lead, 'create_opportunity')}
                              disabled={busy === lead.id || !lead.contactId}
                              className="text-xs px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {busy === lead.id ? '…' : 'Crear oportunidad'}
                            </button>
                            <button
                              onClick={() => act(lead, 'dismiss')}
                              disabled={busy === lead.id}
                              className="text-xs px-2 py-1 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 disabled:opacity-50"
                            >
                              Descartar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
