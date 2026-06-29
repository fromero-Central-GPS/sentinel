'use client';

import { useEffect, useState } from 'react';

type WonTrackData = {
  period: string;
  won: number;
  total: number;
  conversionRate: number;
  avgTicket: number;
  avgCycleDays: number;
  alerts: { type: string; message: string }[];
  error?: string;
  successThresholds?: any;
  businessFeatures?: any;
  communicationPatterns?: any;
};

function formatCLP(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

export default function WonTrackPage() {
  const [data, setData] = useState<WonTrackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'live' | 'mock'>('live');

  useEffect(() => {
    fetch(`/api/engines/won-track?mode=${mode}`)
      .then((r) => r.json())
      .then((d: WonTrackData) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [mode]);

  if (loading && !data) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="text-sm text-zinc-500 animate-pulse">Cargando métricas de conversión…</div>
      </div>
    );
  }

  if (error && !data) {
    const isNoCredentials = error.includes('not configured');
    return (
      <div className="p-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Won Track</h1>
          <button
            onClick={() => setMode(mode === 'live' ? 'mock' : 'live')}
            className="text-xs px-3 py-1.5 rounded-full border border-zinc-200 hover:bg-zinc-50"
          >
            Modo: {mode}
          </button>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center space-y-3">
          <p className="font-semibold text-amber-800">
            {isNoCredentials ? 'Credenciales GHL no configuradas' : 'Error al cargar datos'}
          </p>
          <p className="text-sm text-amber-700">
            {isNoCredentials ? 'Configura tu API Token y Location ID de GHL en Settings.' : error}
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

  if (!data) return null;

  const conversionPct = (data.conversionRate * 100).toFixed(1);
  const isAboveThreshold = data.conversionRate >= 0.2;

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Won Track</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Análisis de oportunidades ganadas y patrones de éxito
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-500">Datos:</span>
          <div className="flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
            <button
              onClick={() => setMode('live')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'live'
                  ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              GHL API
            </button>
            <button
              onClick={() => setMode('mock')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'mock'
                  ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              Demo
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          ⚠️ {error}
        </div>
      )}

      {/* Alerts */}
      {data.alerts && data.alerts.length > 0 && (
        <div className="space-y-2">
          {data.alerts.map((alert, i) => (
            <div
              key={i}
              className={`rounded-lg border px-4 py-3 text-sm ${
                alert.type === 'warning'
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-blue-200 bg-blue-50 text-blue-800'
              }`}
            >
              {alert.type === 'warning' ? '⚠️' : 'ℹ️'} {alert.message}
            </div>
          ))}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Deals ganados</p>
          <p className="mt-2 text-3xl font-bold text-green-600">{data.won}</p>
          <p className="mt-1 text-xs text-zinc-500">de {data.total} totales (30d)</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
            Tasa de conversión
          </p>
          <p
            className={`mt-2 text-3xl font-bold ${isAboveThreshold ? 'text-green-600' : 'text-red-600'}`}
          >
            {conversionPct}%
          </p>
          <p className="mt-1 text-xs text-zinc-500">umbral: 20%</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
            Ticket promedio
          </p>
          <p className="mt-2 text-3xl font-bold text-zinc-900">{formatCLP(data.avgTicket)}</p>
          <p className="mt-1 text-xs text-zinc-500">por deal ganado</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
            Ciclo promedio
          </p>
          <p className="mt-2 text-3xl font-bold text-zinc-900">{data.avgCycleDays}d</p>
          <p className="mt-1 text-xs text-zinc-500">días hasta el cierre</p>
        </div>
      </div>

      {data.successThresholds && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 col-span-full">
            <h2 className="text-lg font-semibold text-zinc-900 mb-4 border-b pb-3">
              Umbrales de Éxito Extraídos
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <p className="text-sm text-zinc-500 mb-1">Cierre rápido</p>
                <p className="text-xl font-medium">
                  &lt; {data.successThresholds.fastCloseThreshold} días
                </p>
              </div>
              <div>
                <p className="text-sm text-zinc-500 mb-1">Riesgo de respuesta</p>
                <p className="text-xl font-medium text-amber-600">
                  &gt; {data.successThresholds.dangerResponseThreshold} min
                </p>
              </div>
              <div>
                <p className="text-sm text-zinc-500 mb-1">Respuesta ideal</p>
                <p className="text-xl font-medium text-green-600">
                  &lt; {data.successThresholds.idealResponseThreshold} min
                </p>
              </div>
              <div>
                <p className="text-sm text-zinc-500 mb-1">Volumen mensajes</p>
                <p className="text-xl font-medium">
                  ~ {data.successThresholds.avgMessagesPerDeal} msgs
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {data.businessFeatures && (
          <div className="rounded-xl border border-zinc-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-zinc-700 mb-4">Top Business Features</h2>
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-zinc-500 uppercase">Top Canal</p>
                <p className="text-lg mt-1 capitalize">{data.businessFeatures.topChannel}</p>
              </div>
              {data.businessFeatures.channelWinRates &&
                Object.keys(data.businessFeatures.channelWinRates).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-zinc-500 uppercase mb-2">
                      Win Rate por Canal
                    </p>
                    {Object.entries(data.businessFeatures.channelWinRates).map(([ch, rate]) => (
                      <div
                        key={ch}
                        className="flex justify-between items-center text-sm py-1 border-b border-zinc-50 last:border-0"
                      >
                        <span className="capitalize text-zinc-700">{ch}</span>
                        <span className="font-mono">{Number(rate).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </div>
        )}

        {data.communicationPatterns && (
          <div className="rounded-xl border border-zinc-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-zinc-700 mb-4">Patrones de Comunicación</h2>
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-zinc-500 uppercase">Tiempo resp. promedio</p>
                <p className="text-lg mt-1">{data.communicationPatterns.avgResponseMinutes} min</p>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-500 uppercase">Tiempo resp. mediano</p>
                <p className="text-lg mt-1">
                  {data.communicationPatterns.medianResponseMinutes} min
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-500 uppercase">Ratio Inbound</p>
                <p className="text-lg mt-1">
                  {(data.communicationPatterns.avgInboundRatio * 100).toFixed(1)}%
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
