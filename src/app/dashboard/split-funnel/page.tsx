'use client';

import { useCallback, useEffect, useState } from 'react';
import { SyncButton } from '@/components/engines/SyncButton';

type Bucket = {
  bucket: 'declarada' | 'creada' | 'desconocida';
  label: string;
  total: number;
  won: number;
  lost: number;
  open: number;
  conversionRate: number;
  avgCycleDays: number;
  medianCycleDays: number;
  avgTicket: number;
  wonValue: number;
  openValue: number;
};

type SplitFunnelData = {
  period: string;
  dataSource?: 'sync' | 'mock';
  syncedAt?: string | null;
  buckets: Bucket[];
  totalDeals: number;
  classifiedPct: number;
  insight: {
    conversionRatio: number | null;
    cycleGapDays: number | null;
    message: string;
  };
  error?: string;
  hint?: string;
};

function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'recién';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

function formatCLP(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

/** Estilos por bucket para que declarada/creada se distingan de un vistazo. */
const BUCKET_STYLE: Record<
  Bucket['bucket'],
  { ring: string; badge: string; bar: string; hint: string }
> = {
  declarada: {
    ring: 'border-emerald-200',
    badge: 'bg-emerald-100 text-emerald-800',
    bar: 'bg-emerald-500',
    hint: 'Alta intención: pidió precio, demo o contacto directo',
  },
  creada: {
    ring: 'border-violet-200',
    badge: 'bg-violet-100 text-violet-800',
    bar: 'bg-violet-500',
    hint: 'Baja intención: entró por contenido, feria o ads fríos',
  },
  desconocida: {
    ring: 'border-zinc-200',
    badge: 'bg-zinc-100 text-zinc-600',
    bar: 'bg-zinc-400',
    hint: 'Sin señal de intención en el mensaje ni en la atribución',
  },
};

export default function SplitFunnelPage() {
  const [data, setData] = useState<SplitFunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'live' | 'mock'>('live');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/engines/split-funnel?mode=${mode}`)
      .then((r) => r.json())
      .then((d: SplitFunnelData) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [mode]);

  useEffect(() => {
    queueMicrotask(() => load());
  }, [load]);

  if (loading && !data) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="text-sm text-zinc-500 animate-pulse">Segmentando la demanda…</div>
      </div>
    );
  }

  if (error && !data) {
    const isNoCredentials = error.includes('not configured');
    return (
      <div className="p-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Split the Funnel</h1>
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

  const hasData = data.buckets.length > 0;

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Split the Funnel</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Demanda declarada vs creada — dos poblaciones que no se miden con la misma vara
          </p>
        </div>
        <div className="flex items-center gap-3">
          {mode === 'live' && <SyncButton onSynced={() => load()} />}
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

      {/* Insight comparativo */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 mb-1">
          Lo que separa las dos demandas
        </p>
        <p className="text-sm text-indigo-900 leading-relaxed">{data.insight.message}</p>
        {data.syncedAt && (
          <p className="mt-2 text-xs text-indigo-400">
            {data.totalDeals} deals · {data.classifiedPct}% clasificados · sincronizado{' '}
            {timeAgo(data.syncedAt)}
          </p>
        )}
      </div>

      {!hasData && (
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
          {data.hint ??
            'Aún no hay funnel sincronizado para segmentar. Sincroniza desde el botón de arriba.'}
        </div>
      )}

      {/* Tarjetas por cohorte */}
      {hasData && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.buckets.map((b) => {
            const style = BUCKET_STYLE[b.bucket];
            return (
              <div key={b.bucket} className={`rounded-xl border ${style.ring} bg-white p-6`}>
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.badge}`}
                  >
                    {b.label}
                  </span>
                  <span className="text-xs text-zinc-400">{b.total} deals</span>
                </div>
                <p className="text-xs text-zinc-500 mb-4">{style.hint}</p>

                <div className="mb-4">
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                      Conversión
                    </p>
                    <p className="text-2xl font-bold text-zinc-900">
                      {(b.conversionRate * 100).toFixed(1)}%
                    </p>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${style.bar}`}
                      style={{ width: `${Math.min(100, b.conversionRate * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">
                    {b.won} ganados · {b.lost} perdidos · {b.open} abiertos
                  </p>
                </div>

                <dl className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                  <div>
                    <dt className="text-xs text-zinc-500">Ciclo (mediana)</dt>
                    <dd className="font-medium text-zinc-900">{b.medianCycleDays}d</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">Ciclo (promedio)</dt>
                    <dd className="font-medium text-zinc-900">{b.avgCycleDays}d</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">Ticket promedio</dt>
                    <dd className="font-medium text-zinc-900">{formatCLP(b.avgTicket)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">Revenue ganado</dt>
                    <dd className="font-medium text-zinc-900">{formatCLP(b.wonValue)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">Pipeline abierto</dt>
                    <dd className="font-medium text-zinc-900">{formatCLP(b.openValue)}</dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      )}

      {/* Tabla comparativa */}
      {hasData && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-zinc-700 mb-4">Comparativa por cohorte</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-xs uppercase tracking-wider text-zinc-500">
                  <th className="py-2 pr-4 font-semibold">Cohorte</th>
                  <th className="py-2 px-3 font-semibold text-right">Deals</th>
                  <th className="py-2 px-3 font-semibold text-right">Conversión</th>
                  <th className="py-2 px-3 font-semibold text-right">Ciclo (mediana)</th>
                  <th className="py-2 px-3 font-semibold text-right">Ticket prom.</th>
                  <th className="py-2 pl-3 font-semibold text-right">Revenue ganado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {data.buckets.map((b) => (
                  <tr key={b.bucket}>
                    <td className="py-2 pr-4 text-zinc-700">{b.label}</td>
                    <td className="py-2 px-3 text-right font-mono text-zinc-500">{b.total}</td>
                    <td className="py-2 px-3 text-right font-mono text-zinc-700">
                      {(b.conversionRate * 100).toFixed(1)}%
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-zinc-600">
                      {b.medianCycleDays}d
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-zinc-600">
                      {formatCLP(b.avgTicket)}
                    </td>
                    <td className="py-2 pl-3 text-right font-mono text-zinc-600">
                      {formatCLP(b.wonValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
