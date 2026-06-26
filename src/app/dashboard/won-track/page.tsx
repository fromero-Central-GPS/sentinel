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

  useEffect(() => {
    fetch('/api/engines/won-track')
      .then((r) => r.json())
      .then((d: WonTrackData) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="text-sm text-zinc-500 animate-pulse">Cargando métricas de conversión…</div>
      </div>
    );
  }

  if (error) {
    const isNoCredentials = error.includes('not configured');
    return (
      <div className="p-8 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Won Track</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center space-y-3">
          <p className="font-semibold text-amber-800">
            {isNoCredentials ? 'Credenciales GHL no configuradas' : 'Error al cargar datos'}
          </p>
          <p className="text-sm text-amber-700">{isNoCredentials ? 'Configura tu API Token y Location ID de GHL en Settings.' : error}</p>
          <a href="/settings" className="inline-block mt-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800">
            Ir a Settings →
          </a>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const conversionPct = (data.conversionRate * 100).toFixed(1);
  const isAboveThreshold = data.conversionRate >= 0.20;

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Won Track</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Métricas de conversión — últimos {data.period === '30d' ? '30 días' : data.period}
        </p>
      </div>

      {/* Alerts */}
      {data.alerts.length > 0 && (
        <div className="space-y-2">
          {data.alerts.map((alert, i) => (
            <div key={i} className={`rounded-lg border px-4 py-3 text-sm ${
              alert.type === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-200 bg-blue-50 text-blue-800'
            }`}>
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
          <p className="mt-1 text-xs text-zinc-500">de {data.total} totales</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Tasa de conversión</p>
          <p className={`mt-2 text-3xl font-bold ${isAboveThreshold ? 'text-green-600' : 'text-red-600'}`}>
            {conversionPct}%
          </p>
          <p className="mt-1 text-xs text-zinc-500">umbral: 20%</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Ticket promedio</p>
          <p className="mt-2 text-3xl font-bold text-zinc-900">{formatCLP(data.avgTicket)}</p>
          <p className="mt-1 text-xs text-zinc-500">por deal ganado</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Ciclo promedio</p>
          <p className="mt-2 text-3xl font-bold text-zinc-900">{data.avgCycleDays}d</p>
          <p className="mt-1 text-xs text-zinc-500">días hasta el cierre</p>
        </div>
      </div>

      {/* Conversion visualization */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-700 mb-4">Funnel de conversión</h2>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-zinc-600">Total oportunidades</span>
              <span className="font-mono font-medium">{data.total}</span>
            </div>
            <div className="h-3 rounded-full bg-zinc-100 overflow-hidden">
              <div className="h-full w-full rounded-full bg-zinc-300" />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-zinc-600">Ganadas</span>
              <span className="font-mono font-medium text-green-700">{data.won} ({conversionPct}%)</span>
            </div>
            <div className="h-3 rounded-full bg-zinc-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${isAboveThreshold ? 'bg-green-500' : 'bg-red-400'}`}
                style={{ width: `${Math.min(100, data.conversionRate * 100)}%` }}
              />
            </div>
          </div>
          <div className="pt-1">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="h-2 w-2 rounded-full bg-zinc-300" />
              <span>Umbral mínimo: 20%</span>
              <span className="ml-auto">
                {isAboveThreshold ? '✓ Por encima del umbral' : '✗ Por debajo del umbral'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
