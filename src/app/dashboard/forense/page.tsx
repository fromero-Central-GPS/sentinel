'use client';

import { useEffect, useState } from 'react';

type LossReason = {
  category: string;
  confidence: number;
  evidence: string[];
};

type ConversationAnalysis = {
  conversationId: string;
  contactName: string;
  opportunityValue: number;
  funnelStage: string;
  lossReason: LossReason;
  recoverability: number;
  summary: string;
};

type BatchResult = {
  analyzedAt?: string;
  totalAnalyzed: number;
  totalValue: number;
  analyses: ConversationAnalysis[];
  topLossReasons: Array<{ category: string; count: number; totalValue: number }>;
};

type ApiResponse = {
  batchResult: BatchResult | null;
  _meta: {
    mode: string;
    analyzedAt?: string;
    conversationCount?: number;
    configured?: boolean;
    note?: string;
  };
  error?: string;
  hint?: string;
};

const LOSS_REASON_LABELS: Record<string, string> = {
  sin_seguimiento: 'Sin seguimiento',
  precio: 'Precio',
  competidor: 'Competidor',
  producto_no_disponible: 'Producto no disponible',
  falta_informacion: 'Falta de información',
  proceso_complejo: 'Proceso complejo',
  cliente_explorando: 'Cliente explorando',
  desconocido: 'Desconocido',
};

const LOSS_REASON_COLORS: Record<string, string> = {
  sin_seguimiento: 'bg-red-100 text-red-700',
  precio: 'bg-orange-100 text-orange-700',
  competidor: 'bg-yellow-100 text-yellow-700',
  producto_no_disponible: 'bg-purple-100 text-purple-700',
  falta_informacion: 'bg-blue-100 text-blue-700',
  proceso_complejo: 'bg-indigo-100 text-indigo-700',
  cliente_explorando: 'bg-green-100 text-green-700',
  desconocido: 'bg-zinc-100 text-zinc-600',
};

function formatCLP(value: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value);
}

function RecoverabilityBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-zinc-200">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-zinc-500">{pct}%</span>
    </div>
  );
}

export default function ForensePage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [mode, setMode] = useState<'mock' | 'live'>('mock');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(m: 'mock' | 'live') {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ghl/forensics?mode=${m}`);
      const json = await res.json() as ApiResponse;
      if (!res.ok) {
        setError(json.error ?? 'Error desconocido');
        setData(json);
      } else {
        setData(json);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(mode); }, [mode]);

  const batch = data?.batchResult;
  const meta = data?._meta;

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Motor Forense</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Clasifica conversaciones perdidas por fase y causa raíz
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode('mock')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${mode === 'mock' ? 'bg-zinc-900 text-white' : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
          >
            Demo
          </button>
          <button
            onClick={() => setMode('live')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${mode === 'live' ? 'bg-blue-600 text-white' : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
          >
            Live (GHL)
          </button>
          {!loading && (
            <button
              onClick={() => void load(mode)}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              ↺ Actualizar
            </button>
          )}
        </div>
      </div>

      {/* Mode banner */}
      {meta && (
        <div className={`rounded-lg px-4 py-2.5 text-sm ${meta.mode === 'mock' ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-blue-50 border border-blue-200 text-blue-800'}`}>
          {meta.mode === 'mock' ? (
            <span>⚠ Modo demo — {meta.note}</span>
          ) : (
            <span>✓ Datos reales de GHL · {meta.conversationCount ?? 0} conversaciones analizadas</span>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>Error:</strong> {error}
          {data?.hint && <p className="mt-1 text-red-700">{data.hint}</p>}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-3 py-8 text-zinc-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600" />
          <span className="text-sm">Analizando conversaciones…</span>
        </div>
      )}

      {/* Summary cards */}
      {!loading && batch && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Conversaciones</p>
              <p className="mt-2 text-3xl font-bold text-zinc-900">{batch.totalAnalyzed}</p>
              <p className="mt-1 text-xs text-zinc-500">analizadas</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Revenue en riesgo</p>
              <p className="mt-2 text-3xl font-bold text-red-600">{formatCLP(batch.totalValue)}</p>
              <p className="mt-1 text-xs text-zinc-500">total perdido</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Causa principal</p>
              <p className="mt-2 text-xl font-bold text-zinc-900">
                {batch.topLossReasons[0]
                  ? LOSS_REASON_LABELS[batch.topLossReasons[0].category] ?? batch.topLossReasons[0].category
                  : '—'}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {batch.topLossReasons[0]?.count ?? 0} conversaciones
              </p>
            </div>
          </div>

          {/* Top loss reasons */}
          {batch.topLossReasons.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-6">
              <h2 className="font-semibold mb-4">Causas de pérdida</h2>
              <div className="space-y-3">
                {batch.topLossReasons.map((reason) => {
                  const label = LOSS_REASON_LABELS[reason.category] ?? reason.category;
                  const colorClass = LOSS_REASON_COLORS[reason.category] ?? 'bg-zinc-100 text-zinc-600';
                  const pct = Math.round((reason.count / batch.totalAnalyzed) * 100);
                  return (
                    <div key={reason.category} className="flex items-center gap-3">
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClass}`}>
                        {label}
                      </span>
                      <div className="flex-1 h-2 rounded-full bg-zinc-100">
                        <div className="h-2 rounded-full bg-blue-500 opacity-70" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-zinc-500 w-8 text-right">{pct}%</span>
                      <span className="text-xs text-zinc-400 w-24 text-right font-mono">{formatCLP(reason.totalValue)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Per-conversation analysis */}
          {batch.analyses && batch.analyses.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white">
              <div className="px-6 py-4 border-b border-zinc-100">
                <h2 className="font-semibold">Análisis por conversación</h2>
              </div>
              <div className="divide-y divide-zinc-100">
                {batch.analyses.map((analysis) => {
                  const reasonLabel = LOSS_REASON_LABELS[analysis.lossReason?.category] ?? analysis.lossReason?.category ?? '—';
                  const colorClass = LOSS_REASON_COLORS[analysis.lossReason?.category] ?? 'bg-zinc-100 text-zinc-600';
                  return (
                    <div key={analysis.conversationId} className="px-6 py-4 space-y-2">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                          <p className="font-medium text-zinc-900">{analysis.contactName}</p>
                          <p className="text-xs text-zinc-500 mt-0.5">{analysis.funnelStage}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>
                            {reasonLabel}
                          </span>
                          <span className="text-sm font-semibold text-zinc-700">
                            {formatCLP(analysis.opportunityValue)}
                          </span>
                        </div>
                      </div>

                      <div>
                        <p className="text-xs text-zinc-500 mb-1">Recuperabilidad</p>
                        <RecoverabilityBar score={analysis.recoverability} />
                      </div>

                      {analysis.summary && (
                        <p className="text-xs text-zinc-600 italic">{analysis.summary}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
