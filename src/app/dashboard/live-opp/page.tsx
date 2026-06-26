'use client';

import { Fragment, useEffect, useState } from 'react';

type Opportunity = {
  id: string;
  name: string;
  stage: string;
  daysSinceActivity: number;
  riskScore: number;
  value: number;
  riskLevel: string;
  recommendedActions: string[];
};

type LiveOppData = {
  totalAtRisk: number;
  totalValue: number;
  opportunities: Opportunity[];
  error?: string;
};

function formatCLP(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function riskConfig(riskLevel: string) {
  switch (riskLevel) {
    case 'critical': return { dot: 'bg-red-500', badge: 'bg-red-50 text-red-700 ring-1 ring-red-200', label: 'Crítico' };
    case 'high': return { dot: 'bg-orange-500', badge: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200', label: 'Alto' };
    case 'medium': return { dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200', label: 'Medio' };
    case 'low': return { dot: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200', label: 'Bajo' };
    default: return { dot: 'bg-green-500', badge: 'bg-green-50 text-green-700', label: 'Sin riesgo' };
  }
}

export default function LiveOppPage() {
  const [data, setData] = useState<LiveOppData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/engines/live-opp')
      .then((r) => r.json())
      .then((d: LiveOppData) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="text-sm text-zinc-500 animate-pulse">Cargando oportunidades en riesgo…</div>
      </div>
    );
  }

  if (error) {
    const isNoCredentials = error.includes('not configured');
    return (
      <div className="p-8 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Live Opp</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center space-y-3">
          <p className="font-semibold text-amber-800">
            {isNoCredentials ? 'Credenciales GHL no configuradas' : 'Error al cargar datos'}
          </p>
          <p className="text-sm text-amber-700">{isNoCredentials ? 'Configura tu API Token y Location ID de GHL para activar este motor.' : error}</p>
          <a href="/settings" className="inline-block mt-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800">
            Ir a Settings →
          </a>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Live Opp</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Oportunidades abiertas sin actividad — ordenadas por riesgo
        </p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">En riesgo</p>
          <p className="mt-2 text-3xl font-bold text-amber-600">{data.totalAtRisk}</p>
          <p className="mt-1 text-xs text-zinc-500">oportunidades sin actividad ≥7 días</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Valor en riesgo</p>
          <p className="mt-2 text-3xl font-bold text-red-600">{formatCLP(data.totalValue)}</p>
          <p className="mt-1 text-xs text-zinc-500">suma de oportunidades en riesgo</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Críticas</p>
          <p className="mt-2 text-3xl font-bold text-red-700">
            {data.opportunities.filter((o) => o.riskLevel === 'critical').length}
          </p>
          <p className="mt-1 text-xs text-zinc-500">sin actividad 21+ días</p>
        </div>
      </div>

      {data.opportunities.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-12 flex flex-col items-center text-center">
          <p className="text-green-600 font-semibold text-lg">¡Sin oportunidades en riesgo!</p>
          <p className="text-sm text-zinc-500 mt-1">Todas las oportunidades abiertas tienen actividad reciente.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700">
              Oportunidades ({data.opportunities.length})
            </h2>
            <p className="text-xs text-zinc-400">Ordenado por riesgo ↓</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50">
                  <th className="py-2 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wide">Oportunidad</th>
                  <th className="py-2 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wide">Riesgo</th>
                  <th className="py-2 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wide">Sin actividad</th>
                  <th className="py-2 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wide">Etapa</th>
                  <th className="py-2 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wide">Valor</th>
                  <th className="py-2 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wide"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.opportunities.map((opp) => {
                  const rc = riskConfig(opp.riskLevel);
                  const isExpanded = expandedId === opp.id;
                  return (
                    <Fragment key={opp.id}>
                      <tr
                        className={`cursor-pointer transition-colors ${isExpanded ? 'bg-zinc-50' : 'hover:bg-zinc-50'}`}
                        onClick={() => setExpandedId(isExpanded ? null : opp.id)}
                      >
                        <td className="py-3 px-4 text-sm font-medium text-zinc-900">{opp.name}</td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${rc.badge}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${rc.dot}`} />
                            {rc.label}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm text-zinc-700 font-mono">{opp.daysSinceActivity}d</td>
                        <td className="py-3 px-4 text-sm text-zinc-500">{opp.stage || '—'}</td>
                        <td className="py-3 px-4 text-sm text-zinc-700 font-mono">{formatCLP(opp.value)}</td>
                        <td className="py-3 px-4 text-center text-zinc-400 text-xs">
                          {isExpanded ? '▲' : '▼'}
                        </td>
                      </tr>
                      {isExpanded && opp.recommendedActions.length > 0 && (
                        <tr className="bg-zinc-50">
                          <td colSpan={6} className="px-4 pb-4 pt-0">
                            <div className="space-y-1.5">
                              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Acciones recomendadas</p>
                              {opp.recommendedActions.map((action, i) => (
                                <p key={i} className="text-sm text-zinc-700 flex items-start gap-2">
                                  <span className="text-zinc-400 mt-0.5">•</span>
                                  <span>{action}</span>
                                </p>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
