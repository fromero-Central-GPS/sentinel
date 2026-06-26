'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type PlanInfo = {
  plan: { name: string; slug: string } | null;
  usage?: {
    conversationsAnalyzed: number;
  };
  limits?: {
    maxConversationsPerMonth: number;
    remaining: number;
    usagePercent: number;
  };
};

export default function PlanBadge() {
  const [info, setInfo] = useState<PlanInfo | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/billing/subscription').then((r) => r.json()),
      fetch('/api/billing/usage').then((r) => r.json()),
    ])
      .then(([subData, usageData]) => {
        setInfo({
          plan: subData.plan ?? null,
          usage: usageData.usage,
          limits: usageData.limits,
        });
      })
      .catch(() => {});
  }, []);

  if (!info?.plan) return null;

  const isFree = info.plan.slug === 'free';
  const badgeClass = isFree
    ? 'bg-zinc-100 text-zinc-600'
    : 'bg-blue-100 text-blue-700';
  const usagePct = info.limits?.usagePercent ?? 0;

  return (
    <div className="space-y-3">
      {/* Plan badge + name */}
      <Link
        href="/pricing"
        className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2.5 hover:bg-zinc-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass}`}>
            {info.plan.name}
          </span>
        </div>
        {isFree && (
          <span className="text-xs font-medium text-blue-600">Upgrade →</span>
        )}
      </Link>

      {/* Usage bar */}
      {info.limits && (
        <div className="px-1">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-zinc-500">Conversaciones</span>
            <span className="text-zinc-600 font-mono">
              {usagePct}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                usagePct >= 90 ? 'bg-red-500' : usagePct >= 70 ? 'bg-amber-400' : 'bg-blue-500'
              }`}
              style={{ width: `${Math.min(100, usagePct)}%` }}
            />
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            {info.limits.remaining.toLocaleString()} restantes
          </p>
        </div>
      )}
    </div>
  );
}
