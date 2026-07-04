'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Botón de sincronización full-funnel GHL → BD.
 *
 * El endpoint procesa UNA página por request y devuelve un cursor; este
 * componente re-invoca en loop hasta `done`, mostrando progreso por status.
 * Al terminar dispara `onSynced` para que la pantalla recargue sus datos.
 */

type SyncCursor = { statusIndex: number; page?: { startAfter?: string; startAfterId?: string } };

type SyncPageResponse = {
  status: string;
  processed: number;
  totalForStatus: number;
  cursor: SyncCursor | null;
  done: boolean;
  syncStatus?: { counts: Record<string, number>; lastSyncedAt: string | null };
  error?: string;
};

const STATUS_LABELS: Record<string, string> = {
  won: 'ganadas',
  lost: 'perdidas',
  open: 'abiertas',
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'nunca';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'recién';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

export function SyncButton({ onSynced }: { onSynced?: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [totalSynced, setTotalSynced] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/engines/sync')
      .then((r) => r.json())
      .then((d: { counts?: Record<string, number>; lastSyncedAt?: string | null }) => {
        setLastSyncedAt(d.lastSyncedAt ?? null);
        const counts = d.counts ?? {};
        const total = Object.values(counts).reduce((s, n) => s + n, 0);
        setTotalSynced(total > 0 ? total : null);
      })
      .catch(() => {});
  }, []);

  const runSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    let cursor: SyncCursor | null = null;
    const doneByStatus: Record<string, number> = {};
    try {
      do {
        const res = await fetch('/api/engines/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cursor }),
        });
        const data = (await res.json()) as SyncPageResponse;
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);

        doneByStatus[data.status] = (doneByStatus[data.status] ?? 0) + data.processed;
        const label = STATUS_LABELS[data.status] ?? data.status;
        setProgress(`${label}: ${doneByStatus[data.status]}/${data.totalForStatus}`);

        cursor = data.cursor;
        if (data.done && data.syncStatus) {
          setLastSyncedAt(data.syncStatus.lastSyncedAt);
          const total = Object.values(data.syncStatus.counts).reduce((s, n) => s + n, 0);
          setTotalSynced(total > 0 ? total : null);
        }
      } while (cursor !== null);
      onSynced?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
      setProgress(null);
    }
  }, [onSynced]);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={runSync}
        disabled={syncing}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
        title="Trae todas las oportunidades (ganadas/perdidas/abiertas) de GHL a la base local"
      >
        {syncing ? `⏳ Sincronizando… ${progress ?? ''}` : '⇅ Sincronizar GHL'}
      </button>
      <span className="text-[11px] text-zinc-400">
        {error
          ? `error: ${error}`
          : totalSynced !== null
            ? `${totalSynced} opps · ${timeAgo(lastSyncedAt)}`
            : 'sin sincronizar'}
      </span>
    </div>
  );
}
