/**
 * Engine Runners — núcleo de cada motor invocable con un `orgId` EXPLÍCITO,
 * sin depender de `auth()` de Clerk ni del request context (P1-1: corridas
 * programadas por cron).
 *
 * Las rutas `/api/engines/*` siguen sirviendo al dashboard interactivo (con
 * auth + plan enforcement por request). Estos runners son la entrada
 * server-side para los cron jobs de plataforma: iteran los tenants con GHL
 * configurado y ejecutan la misma lógica de cómputo/LLM que las rutas, pero con
 * el tenant pasado por parámetro y sin enforcement (la corrida la paga la
 * plataforma, no cuenta contra el quota del tenant).
 *
 * Reglas heredadas (no repetir bugs de jul-2026):
 *  - Verificar credenciales con `pingLLM`/`resolveWorkingAIConfig` ANTES del batch.
 *  - Cachear SOLO diagnósticos que salieron realmente del LLM (nunca el fallback).
 *  - Concurrencia LLM acotada (2), nunca N en paralelo.
 */

import { isNotNull, and } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { decrypt } from '@/lib/encryption';
import type { GhlCredentials } from '@/lib/ghl-client';
import { mapWithConcurrency } from '@/lib/ghl-client';
import { getSyncedDeals, getSyncStatus, syncDealsPage, type SyncCursor } from '@/lib/deal-sync';
import { resolveWorkingAIConfig } from '@/lib/ai-config';
import { getLlmAnalysis, saveLlmAnalysis } from '@/lib/llm-store';
import { diagnoseLossReasonLLM } from '@/lib/forense-llm';
import { summarizeWinningPlaybookLLM } from '@/lib/wontrack-llm';
import {
  analyzeWonDeal,
  generateWonTrackOutput,
  type CustomFieldMap,
} from '@/lib/won-track-engine';
import { saveTenantThresholds } from '@/lib/won-track-store';
import type { LossReasonDiagnosis } from '@/lib/analysis-engine';
import type { LLMUsage } from '@/lib/llm';

/** Cuántos deals perdidos analiza el LLM por corrida (drena el backlog de a poco). */
const FORENSE_BATCH_SIZE = 25;
/** Concurrencia del batch LLM (revienta el rate limit del gateway si es mayor). */
const LLM_CONCURRENCY = 2;
/** Máximo de páginas de sync por invocación de cron (cota de tiempo serverless). */
const SYNC_MAX_PAGES = 40;

export interface GhlTenant {
  tenantId: string;
  creds: GhlCredentials;
  fieldMap: CustomFieldMap;
  /** Pipeline de ventas del tenant (GHL). null → sin filtro (todas las opps). */
  salesPipelineId: string | null;
}

/**
 * Tenants con GHL configurado (token + location). Devuelve las credenciales ya
 * desencriptadas — es el punto de entrada de todos los cron jobs.
 */
export async function listGhlTenants(): Promise<GhlTenant[]> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(and(isNotNull(appSettings.ghlApiToken), isNotNull(appSettings.ghlLocationId)));

  const out: GhlTenant[] = [];
  for (const row of rows) {
    if (!row.ghlApiToken || !row.ghlLocationId) continue;
    try {
      out.push({
        tenantId: row.tenantId,
        creds: { token: decrypt(row.ghlApiToken), locationId: row.ghlLocationId },
        fieldMap: { plan: row.ghlFieldPlan ?? undefined, equipos: row.ghlFieldEquipos ?? undefined },
        salesPipelineId: row.ghlSalesPipelineId ?? null,
      });
    } catch {
      // Token no desencriptable (key rotada / dato corrupto): sáltalo, no
      // tumbes toda la corrida por un tenant.
    }
  }
  return out;
}

/**
 * Autoriza una request de cron. Vercel adjunta `Authorization: Bearer $CRON_SECRET`
 * automáticamente cuando la env var existe. Fail-closed si CRON_SECRET está
 * definida y no coincide; si no está definida (dev), se permite.
 */
export function verifyCronAuth(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev / sin secret configurado
  const header = request.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

// ─── Sync ─────────────────────────────────────────────────────────────────

export interface SyncRunResult {
  tenantId: string;
  pages: number;
  processed: number;
  messagesFetched: number;
  done: boolean;
  error?: string;
}

/**
 * Sincroniza el funnel del tenant recorriendo páginas hasta terminar o agotar
 * el presupuesto de páginas. El sync es incremental (solo re-trae mensajes de
 * deals cambiados), así que aunque una corrida no termine, la siguiente
 * continúa barato.
 */
export async function runSyncForTenant(
  tenantId: string,
  creds: GhlCredentials,
  opts?: { maxPages?: number },
): Promise<SyncRunResult> {
  const maxPages = opts?.maxPages ?? SYNC_MAX_PAGES;
  let cursor: SyncCursor | null = null;
  let pages = 0;
  let processed = 0;
  let messagesFetched = 0;
  try {
    do {
      const result = await syncDealsPage(tenantId, creds, cursor);
      pages++;
      processed += result.processed;
      messagesFetched += result.messagesFetched;
      cursor = result.cursor;
    } while (cursor && pages < maxPages);
    return { tenantId, pages, processed, messagesFetched, done: cursor === null };
  } catch (err) {
    return {
      tenantId,
      pages,
      processed,
      messagesFetched,
      done: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Forense (drena diagnósticos LLM pendientes) ──────────────────────────

export interface ForenseRunResult {
  tenantId: string;
  candidates: number;
  analyzed: number;
  cachedBefore: number;
  usage: LLMUsage;
  llmError?: string;
  error?: string;
}

/**
 * Corre el batch LLM de razón de pérdida sobre los deals perdidos sincronizados
 * que aún no tienen diagnóstico cacheado (top por valor). Ideal para el cron
 * nocturno: cada corrida drena `batchSize` y con los días cubre las cientos de
 * perdidas sin intervención manual.
 */
export async function runForenseForTenant(
  tenantId: string,
  creds: GhlCredentials,
  opts?: { batchSize?: number },
): Promise<ForenseRunResult> {
  const batchSize = opts?.batchSize ?? FORENSE_BATCH_SIZE;
  const usage: LLMUsage = { inputTokens: 0, outputTokens: 0 };
  try {
    // Necesitamos deals sincronizados; si el tenant nunca sincronizó, no hay
    // nada que drenar (el cron de sync corre antes y los crea).
    const synced = await getSyncedDeals(tenantId, 'lost');
    if (synced.length === 0) {
      return { tenantId, candidates: 0, analyzed: 0, cachedBefore: 0, usage };
    }

    const cachedRecs = await getLlmAnalysis<LossReasonDiagnosis>(tenantId, 'forense');
    const cached = new Set(cachedRecs.map((r) => r.key));

    const candidates = [...synced]
      .filter(({ deal, messages }) => messages.length > 0 && !cached.has(deal.id))
      .sort((a, b) => (b.deal.monetaryValue ?? 0) - (a.deal.monetaryValue ?? 0))
      .slice(0, batchSize);

    if (candidates.length === 0) {
      return { tenantId, candidates: 0, analyzed: 0, cachedBefore: cached.size, usage };
    }

    // Verifica credenciales ANTES del batch (lección BYOK jul-2026).
    const resolved = await resolveWorkingAIConfig(tenantId);
    if (!resolved.config) {
      return {
        tenantId,
        candidates: candidates.length,
        analyzed: 0,
        cachedBefore: cached.size,
        usage,
        llmError: resolved.error,
      };
    }

    const aiConfig = resolved.config;
    const results = new Map<string, LossReasonDiagnosis>();
    const errors: string[] = [];
    await mapWithConcurrency(candidates, LLM_CONCURRENCY, async ({ deal, messages }) => {
      const diagnosis = await diagnoseLossReasonLLM(
        messages,
        aiConfig,
        (u) => {
          usage.inputTokens += u.inputTokens;
          usage.outputTokens += u.outputTokens;
        },
        (message) => errors.push(message),
      );
      // Solo diagnósticos REALES del LLM entran a la caché.
      if (diagnosis) results.set(deal.id, diagnosis);
    });

    if (results.size > 0) {
      await Promise.all(
        [...results.entries()].map(([oppId, diagnosis]) =>
          saveLlmAnalysis(tenantId, 'forense', oppId, diagnosis, aiConfig.model),
        ),
      );
    }

    return {
      tenantId,
      candidates: candidates.length,
      analyzed: results.size,
      cachedBefore: cached.size,
      usage,
      llmError: results.size < candidates.length ? errors[0] : undefined,
    };
  } catch (err) {
    return {
      tenantId,
      candidates: 0,
      analyzed: 0,
      cachedBefore: 0,
      usage,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Won Track (recomputa blueprint + playbook) ───────────────────────────

export interface WonTrackRunResult {
  tenantId: string;
  wonDeals: number;
  playbookUpdated: boolean;
  usage: LLMUsage;
  llmError?: string;
  error?: string;
}

/**
 * Recomputa los umbrales de éxito (blueprint que consume Live Opp) sobre TODOS
 * los deals ganados sincronizados y, si `useLLM`, refresca la narrativa playbook.
 * Cron semanal.
 */
export async function runWonTrackForTenant(
  tenantId: string,
  creds: GhlCredentials,
  opts?: { useLLM?: boolean; fieldMap?: CustomFieldMap },
): Promise<WonTrackRunResult> {
  const usage: LLMUsage = { inputTokens: 0, outputTokens: 0 };
  void creds; // el cómputo lee de la BD sincronizada; creds queda para paridad de firma
  try {
    const synced = await getSyncedDeals(tenantId, 'won');
    if (synced.length === 0) {
      return { tenantId, wonDeals: 0, playbookUpdated: false, usage };
    }

    const deals = synced.map(({ deal, messages }) =>
      analyzeWonDeal(deal, messages, opts?.fieldMap),
    );
    const output = generateWonTrackOutput(
      deals,
      deals.map((d) => d.features),
      deals.map((d) => d.patterns),
    );

    // Persistir el blueprint → lo consume Live Opp.
    await saveTenantThresholds(tenantId, output.thresholds);

    let playbookUpdated = false;
    let llmError: string | undefined;
    if (opts?.useLLM) {
      const resolved = await resolveWorkingAIConfig(tenantId);
      if (!resolved.config) {
        llmError = resolved.error;
      } else {
        const summary = await summarizeWinningPlaybookLLM(output, resolved.config, (u) => {
          usage.inputTokens += u.inputTokens;
          usage.outputTokens += u.outputTokens;
        });
        if (summary) {
          await saveLlmAnalysis(tenantId, 'won_track', 'playbook', summary, resolved.config.model);
          playbookUpdated = true;
        } else {
          llmError = 'El LLM no devolvió un playbook.';
        }
      }
    }

    return { tenantId, wonDeals: deals.length, playbookUpdated, usage, llmError };
  } catch (err) {
    return {
      tenantId,
      wonDeals: 0,
      playbookUpdated: false,
      usage,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export { getSyncStatus };
