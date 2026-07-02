/**
 * Tipos canónicos de Sentinel — la capa de datos que comparten los 3 motores.
 *
 * Antes cada motor definía su propio `GHLMessage` (3 copias) y su propia forma de
 * oportunidad (`GHLOpportunity` / `OpenOpportunity` / `GHLOpportunityInput`), y
 * cada ruta repetía el mapeo crudo→motor. Acá vive UN solo `Deal` y UN solo
 * `CanonicalMessage`, más los mappers desde los tipos crudos de GHL.
 *
 * Estos tipos son CRM-agnósticos a propósito: integrar otro CRM = escribir un
 * cliente que produzca `RawOpportunity`/`RawMessage` (ver `ghl-client.ts`) y
 * pasarlos por `toDeal`/`toMessage`. Los motores nunca tocan formas crudas.
 */

import type { RawOpportunity, RawMessage, OpportunityStatus } from './ghl-client';

// ─── Mensaje canónico ─────────────────────────────────────────────────────────

/**
 * Mensaje normalizado de una conversación. Superconjunto de los 3 `GHLMessage`
 * que existían: lo que un motor no usa simplemente queda opcional.
 */
export interface CanonicalMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  messageType: string;
  dateAdded: string;
  status?: string;
  source?: string;
  contentType?: string;
  attachments?: Array<{ url: string }>;
  meta?: Record<string, unknown>;
}

// ─── Oportunidad / Deal canónico ──────────────────────────────────────────────

export type DealStatus = OpportunityStatus; // 'open' | 'won' | 'lost' | 'abandoned'

export interface DealContact {
  id: string;
  name: string;
  companyName?: string | null;
  email?: string;
  phone?: string;
  tags?: string[];
  score?: Array<{ id: string; score: number }>;
}

export interface DealCustomField {
  id: string;
  fieldValueString?: string;
  fieldValueNumber?: number;
  type?: string;
}

export interface DealAttribution {
  utmSessionSource?: string;
  medium?: string;
  isFirst?: boolean;
  isLast?: boolean;
}

/**
 * Oportunidad de venta normalizada. Superconjunto de las tres formas que usaban
 * los motores; los campos que solo usa un motor quedan opcionales.
 */
export interface Deal {
  id: string;
  name: string;
  status: DealStatus;
  monetaryValue: number;
  pipelineId?: string;
  pipelineName: string;
  pipelineStageId?: string;
  pipelineStageName: string;
  createdAt: string;
  updatedAt: string;
  lastStageChangeAt?: string;
  contactId: string;
  /** ID del usuario GHL asignado (vendedor responsable) — CEN-1000. */
  assignedTo?: string;
  contact: DealContact;
  customFields?: DealCustomField[];
  attributions?: DealAttribution[];
}

// ─── Mappers crudo → canónico ─────────────────────────────────────────────────

/**
 * Normaliza un `RawMessage` de GHL al mensaje canónico. Hoy es casi identidad
 * (el `ghl-client` ya normaliza dirección/body), pero es el único punto donde un
 * futuro CRM adaptaría su forma de mensaje.
 */
export function toMessage(raw: RawMessage): CanonicalMessage {
  return {
    id: raw.id,
    direction: raw.direction,
    body: raw.body ?? '',
    messageType: raw.messageType,
    dateAdded: raw.dateAdded,
    attachments: raw.attachments,
  };
}

/**
 * Normaliza una `RawOpportunity` de GHL (campos inconsistentes/anidados) al
 * `Deal` canónico. Centraliza el mapeo que antes vivía duplicado en cada ruta
 * (`toEngineOpportunity` en won-track, `normalizedOpp` en live-opp).
 *
 * @param defaultStatus estado a asumir si GHL no lo informa (la ruta sabe qué
 *   bucket pidió: 'won' en Won Track, 'open' en Live Opp).
 */
export function toDeal(raw: RawOpportunity, defaultStatus: DealStatus = 'open'): Deal {
  const now = new Date().toISOString();
  const contactId = raw.contact?.id ?? raw.contactId ?? raw.id;
  const contactName = raw.contact?.name ?? raw.name ?? 'Desconocido';

  return {
    id: raw.id,
    name: raw.name ?? contactName,
    status: (raw.status as DealStatus | undefined) ?? defaultStatus,
    monetaryValue: raw.monetaryValue ?? 0,
    pipelineId: raw.pipelineId,
    pipelineName: raw.pipeline?.name ?? raw.pipelineName ?? '',
    pipelineStageId: raw.pipelineStageId,
    pipelineStageName: raw.pipelineStage?.name ?? raw.pipelineStageName ?? '',
    createdAt: raw.createdAt ?? raw.dateAdded ?? now,
    updatedAt: raw.updatedAt ?? raw.lastStageChangeAt ?? now,
    lastStageChangeAt: raw.lastStageChangeAt,
    assignedTo: raw.assignedTo,
    contactId,
    contact: {
      id: contactId,
      name: contactName,
      companyName: raw.contact?.companyName ?? null,
      email: raw.contact?.email,
      phone: raw.contact?.phone,
      tags: raw.contact?.tags,
      score: raw.contact?.score,
    },
    customFields: raw.customFields,
    attributions: raw.attributions,
  };
}

/** Mapea una tanda de mensajes crudos al canónico. */
export function toMessages(raws: RawMessage[]): CanonicalMessage[] {
  return raws.map(toMessage);
}
