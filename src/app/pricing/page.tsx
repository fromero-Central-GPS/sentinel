'use client';

import { useUser, useOrganizationList } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import Link from 'next/link';

type Plan = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priceMonthlyClp: string | null;
  features: string | null;
  maxTenantUsers: string | null;
  maxConversationsPerMonth: string | null;
  hasForense: string | null;
  hasLiveOpp: string | null;
  hasWonTrack: string | null;
};

const FEATURE_IOCNS: Record<string, string> = {
  conversaciones: '💬',
  usuarios: '👥',
  forense: '🔍',
  live_opp: '⚡',
  won_track: '📊',
  api: '🔌',
  soporte: '🎧',
  personalizado: '⭐',
};

function formatCLP(value: string | null): string {
  if (!value || value === '0') return 'Gratis';
  const num = parseInt(value, 10);
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(0)}M/mes`;
  if (num >= 1_000) return `$${(num / 1_000).toLocaleString('es-CL')}/mes`;
  return `$${num}/mes`;
}

function formatNumber(value: string | null): string {
  if (!value) return '—';
  const num = parseInt(value, 10);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(0)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
  return String(num);
}

function parseFeatures(features: string | null): string[] {
  if (!features) return [];
  try {
    const parsed = JSON.parse(features);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return features.split(',').map((f) => f.trim());
  }
}

function featureIcon(name: string): string {
  const key = Object.keys(FEATURE_IOCNS).find((k) => name.toLowerCase().includes(k));
  return key ? FEATURE_IOCNS[key] : '✓';
}

export default function PricingPage() {
  const { isLoaded: userLoaded, isSignedIn } = useUser();
  const { isLoaded: orgsLoaded, setActive } = useOrganizationList();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [changingPlan, setChangingPlan] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/billing/plans')
      .then((r) => r.json())
      .then((d: { plans: Plan[] }) =>
        setPlans(
          d.plans.sort((a, b) => {
            const order: Record<string, number> = { free: 0, pro: 1, enterprise: 2 };
            return (order[a.slug] ?? 99) - (order[b.slug] ?? 99);
          }),
        ),
      )
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSelectPlan(planSlug: string) {
    if (!isSignedIn) return;

    if (planSlug === 'free') {
      window.location.href = '/sign-up';
      return;
    }

    setChangingPlan(planSlug);

    try {
      const res = await fetch('/api/billing/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planSlug }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Error al actualizar el plan');
        setChangingPlan(null);
        return;
      }

      window.location.href = '/dashboard';
    } catch {
      alert('Error de conexión');
      setChangingPlan(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="text-sm text-zinc-500 animate-pulse">Cargando planes…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Nav */}
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Sentinel
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/pricing" className="font-medium text-blue-600">
            Planes
          </Link>
          {isSignedIn ? (
            <Link
              href="/dashboard"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Dashboard
            </Link>
          ) : (
            <Link
              href="/sign-in"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Iniciar sesión
            </Link>
          )}
        </nav>
      </header>

      {/* Hero */}
      <div className="mx-auto max-w-4xl px-6 pt-20 pb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Planes y precios</h1>
        <p className="mt-3 text-lg text-zinc-600">
          Elige el plan que mejor se adapte a tu equipo comercial
        </p>
      </div>

      {/* Plan cards */}
      <div className="mx-auto max-w-5xl px-6 pb-24">
        <div className="grid gap-6 md:grid-cols-3">
          {plans.map((plan) => {
            const features = parseFeatures(plan.features);
            const isFree = plan.slug === 'free';
            const isPro = plan.slug === 'pro';
            const isEnterprise = plan.slug === 'enterprise';

            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-2xl border bg-white p-6 ${
                  isPro ? 'border-blue-300 ring-2 ring-blue-500/20 shadow-lg' : 'border-zinc-200'
                }`}
              >
                {isPro && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-1 text-xs font-semibold text-white">
                    Más popular
                  </span>
                )}

                <div className="mb-6">
                  <h2 className="text-xl font-bold">{plan.name}</h2>
                  {plan.description && (
                    <p className="mt-1 text-sm text-zinc-500">{plan.description}</p>
                  )}
                </div>

                <div className="mb-6">
                  <p className="text-3xl font-bold">{formatCLP(plan.priceMonthlyClp)}</p>
                  {!isFree && (
                    <p className="text-xs text-zinc-400 mt-1">CLP, facturación mensual</p>
                  )}
                </div>

                {/* Limits */}
                <div className="mb-6 space-y-2 text-sm">
                  <div className="flex justify-between rounded-lg bg-zinc-50 px-3 py-2">
                    <span className="text-zinc-600">Conversaciones/mes</span>
                    <span className="font-semibold">
                      {formatNumber(plan.maxConversationsPerMonth)}
                    </span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-zinc-50 px-3 py-2">
                    <span className="text-zinc-600">Usuarios</span>
                    <span className="font-semibold">{plan.maxTenantUsers}</span>
                  </div>
                </div>

                {/* Features */}
                <ul className="mb-8 space-y-2.5 flex-1">
                  <li className="flex items-center gap-2 text-sm">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                        plan.hasForense === 'true'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-zinc-100 text-zinc-300'
                      }`}
                    >
                      {plan.hasForense === 'true' ? '✓' : '—'}
                    </span>
                    Motor Forense
                  </li>
                  <li className="flex items-center gap-2 text-sm">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                        plan.hasLiveOpp === 'true'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-zinc-100 text-zinc-300'
                      }`}
                    >
                      {plan.hasLiveOpp === 'true' ? '✓' : '—'}
                    </span>
                    Motor Live Opp
                  </li>
                  <li className="flex items-center gap-2 text-sm">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                        plan.hasWonTrack === 'true'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-zinc-100 text-zinc-300'
                      }`}
                    >
                      {plan.hasWonTrack === 'true' ? '✓' : '—'}
                    </span>
                    Motor Won Track
                  </li>
                  {features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-zinc-600">
                      <span className="text-green-600">{featureIcon(f)}</span>
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <button
                  onClick={() => handleSelectPlan(plan.slug)}
                  disabled={changingPlan === plan.slug}
                  className={`w-full rounded-xl py-3 text-sm font-semibold transition-colors ${
                    isFree
                      ? 'border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50'
                      : isPro
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-zinc-900 text-white hover:bg-zinc-800'
                  } disabled:opacity-50`}
                >
                  {changingPlan === plan.slug
                    ? 'Actualizando…'
                    : isSignedIn
                      ? isFree
                        ? 'Plan actual'
                        : 'Seleccionar plan'
                      : isFree
                        ? 'Comenzar gratis'
                        : 'Contratar'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
