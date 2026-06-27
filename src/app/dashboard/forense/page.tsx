'use client';

import { useEffect, useState } from 'react';
import type { BatchAnalysisResult, ConversationAnalysis, LossReasonCategory, RecoverabilityPriority } from '@/lib/analysis-engine';

type ForenseResponse = {
  batchResult: BatchAnalysisResult;
  _meta: {
    mode: 'live' | 'mock';
    analyzedAt: string;
    note?: string;
    source?: string;
  };
  error?: string;
};

const PRIORITY_CONFIG: Record<RecoverabilityPriority, { label: string; className: string }> = {
  urgent: { label: 'URGENTE', className: 'bg-red-100 text-red-700 ring-1 ring-red-200' },
  high: { label: 'ALTA', className: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' },
  medium: { label: 'MEDIA', className: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200' },
  low: { label: 'BAJA', className: 'bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200' },
};

const REASON_LABELS: Record<LossReasonCategory, string> = {
  sin_seguimiento: 'Sin seguimiento',
  precio: 'Precio',
  competidor: 'Competidor',
  producto_no_disponible: 'Prod. no disponible',
  falta_informacion: 'Falta información',
  proceso_complejo: 'Proceso complejo',
  cliente_explorando: 'Cliente explorando',
  desconocido: 'Desconocido',
};

function formatCLP(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function PriorityBadge({ priority }: { priority: RecoverabilityPriority }) {
  const cfg = PRIORITY_CONFIG[priority];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${accent ?? 'text-zinc-900'}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

function ConversationRow({ item }: { item: ConversationAnalysis }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr
        className="cursor-pointer hover:bg-zinc-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="py-3 px-4 text-sm font-medium text-zinc-900">{item.contactName}</td>
        <td className="py-3 px-4">
          <PriorityBadge priority={item.recoverability.priority} />
        </td>
        <td className="py-3 px-4 text-sm text-zinc-600">{item.recoverability.totalScore}/100</td>
        <td className="py-3 px-4 text-sm text-zinc-700 font-mono">{formatCLP(item.opportunityValue)}</td>
        <td className="py-3 px-4 text-sm text-zinc-600">
          {REASON_LABELS[item.lossReason.primaryReason]}
        </td>
        <td className="py-3 px-4 text-sm text-zinc-500">
          {item.abandonment.daysSinceLastContact}d
        </td>
        <td className="py-3 px-4 text-sm text-zinc-500">{item.channel}</td>
        <td className="py-3 px-4 text-center text-zinc-400 text-xs">
          {expanded ? '▲' : '▼'}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-zinc-50">
          <td colSpan={8} className="px-4 pb-4 pt-2">
            <div className="grid gap-4 sm:grid-cols-2 text-sm">
              <div>
                <p className="font-medium text-zinc-700 mb-1">Etapa detectada</p>
                <p className="text-zinc-600">{item.stageClassification.detectedStage.replace(/_/g, ' ')}</p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Confianza: {Math.round(item.stageClassification.confidence * 100)}%
                </p>
              </div>
              <div>
                <p className="font-medium text-zinc-700 mb-1">Razón de pérdida</p>
                <p className="text-zinc-600">{REASON_LABELS[item.lossReason.primaryReason]}</p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Confianza: {Math.round(item.lossReason.confidence * 100)}%
                </p>
              </div>
              <div>
                <p className="font-medium text-zinc-700 mb-1">Acción sugerida</p>
                <p className="text-zinc-600">{item.lossReason.suggestedAction}</p>
              </div>
              <div>
                <p className="font-medium text-zinc-700 mb-1">Señales de compra</p>
                {item.intentSignals.signals.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {item.intentSignals.signals.map((s) => (
                      <span key={s} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                        {s.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-zinc-400 text-xs">Ninguna detectada</p>
                )}
              </div>
              <div>
                <p className="font-medium text-zinc-700 mb-1">Factores de recuperabilidad</p>
                {item.recoverability.factors.length > 0 ? (
                  <ul className="text-xs text-zinc-600 space-y-0.5">
                    {item.recoverability.factors.map((f, i) => (
                      <li key={i}>· {f}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-zinc-400 text-xs">Sin factores destacados</p>
                )}
              </div>
              <div>
                <p className="font-medium text-zinc-700 mb-1">Dirección del abandono</p>
                <p className="text-zinc-600">
                  {item.abandonment.direction === 'inbound_sin_respuesta'
                    ? '⚠️ Cliente esperando respuesta'
                    : item.abandonment.direction === 'outbound_sin_respuesta'
                    ? 'Seguimiento sin respuesta del cliente'
                    : item.abandonment.direction === 'mutuo_silencio'
                    ? 'Silencio mutuo'
                    : 'Conversación activa'}
                </p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ForensePage() {
  const [data, setData] = useState<ForenseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'live'|'mock'>('live');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/engines/forense?mode=${mode}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [mode]);

  if (loading && !data) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="text-sm text-zinc-500 animate-pulse">Analizando conversaciones…</div>
      </div>
    );
  }

  if (error && !data) {
    const isNoCredentials = error.includes('not configured');
    return (
      <div className="p-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Forense</h1>
          <button 
             onClick={() => setMode(mode === 'live' ? 'mock' : 'live')}
             className="text-xs px-3 py-1.5 rounded-full border border-zinc-200 hover:bg-zinc-50"
          >
             Modo: {mode}
          </button>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center space-y-3">
          <p className="font-semibold text-amber-800">
            {isNoCredentials ? 'Credenciales GHL no configuradas' : 'Error al cargar análisis'}
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

  const { batchResult, _meta } = data;

  if (!batchResult) {
    return (
      <div className="p-6 md:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Forense</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Análisis de conversaciones perdidas — clasificación por causa raíz y recuperabilidad
            </p>
          </div>
          <button
            onClick={() => setMode('mock')}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-zinc-200 hover:bg-zinc-50"
          >
            Ver datos demo
          </button>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center space-y-3">
          <p className="font-medium text-zinc-700">No hay oportunidades perdidas en GHL</p>
          {_meta.note && <p className="text-sm text-zinc-500">{_meta.note}</p>}
          <p className="text-xs text-zinc-400">
            Las oportunidades con estado &quot;lost&quot; en tu pipeline de GHL aparecerán aquí automáticamente.
          </p>
        </div>
      </div>
    );
  }

  const { summary } = batchResult;

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Forense</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Análisis de conversaciones perdidas — clasificación por causa raíz y recuperabilidad
          </p>
        </div>
        <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-500">Datos:</span>
            <div className="flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
              <button
                onClick={() => setMode('live')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  mode === 'live' ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200' : 'text-zinc-500 hover:text-zinc-900'
                }`}
              >
                GHL API
              </button>
              <button
                onClick={() => setMode('mock')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  mode === 'mock' ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200' : 'text-zinc-500 hover:text-zinc-900'
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

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Conversaciones analizadas"
          value={String(batchResult.totalAnalyzed)}
          sub={`Analizadas el ${new Date(_meta.analyzedAt).toLocaleDateString('es-CL')}`}
        />
        <SummaryCard
          label="Valor perdido total"
          value={formatCLP(summary.totalValue)}
          accent="text-red-600"
          sub="Suma de oportunidades perdidas"
        />
        <SummaryCard
          label="Recuperabilidad URG/ALTA"
          value={formatCLP(summary.recoverableValue)}
          accent="text-amber-600"
          sub={`${summary.highPriorityCount} oportunidades`}
        />
        <SummaryCard
          label="Principal causa pérdida"
          value={summary.topLossReasons[0] ? (REASON_LABELS[summary.topLossReasons[0].reason] ?? summary.topLossReasons[0].reason) : '—'}
          sub={summary.topLossReasons[0] ? `${summary.topLossReasons[0].count} casos` : 'Sin datos'}
        />
      </div>

      {/* Main Table */}
      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50">
                <th className="py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Oportunidad</th>
                <th className="py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Recuperabilidad</th>
                <th className="py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Score</th>
                <th className="py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Valor</th>
                <th className="py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Causa Raíz</th>
                <th className="py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Días sin Contacto</th>
                <th className="py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Canal</th>
                <th className="py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {batchResult.conversations
                .sort((a, b) => b.recoverability.totalScore - a.recoverability.totalScore)
                .map((item) => (
                  <ConversationRow key={item.conversationId} item={item} />
                ))}
              {batchResult.conversations.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-zinc-500">
                    No se encontraron oportunidades perdidas para analizar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
