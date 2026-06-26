import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: text('clerk_id').notNull().unique(),
  email: text('email').notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkOrgId: text('clerk_org_id').notNull().unique(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userOrganizations = pgTable('user_organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const appSettings = pgTable('app_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull().unique(),
  // GHL credentials (AES-256-GCM encrypted)
  ghlApiToken: text('ghl_api_token'),
  ghlLocationId: text('ghl_location_id'),
  // Meta / WhatsApp Business credentials (AES-256-GCM encrypted)
  metaWabaId: text('meta_waba_id'),
  metaPhoneNumberId: text('meta_phone_number_id'),
  metaAccessToken: text('meta_access_token'),
  metaWebhookVerifyToken: text('meta_webhook_verify_token'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Billing ────────────────────────────────────────────────────────────

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),                    // e.g. "Free", "Pro", "Enterprise"
  slug: text('slug').notNull().unique(),            // e.g. "free", "pro", "enterprise"
  description: text('description'),
  priceMonthlyClp: text('price_monthly_clp'),       // e.g. "0", "49900", "149900"
  features: text('features'),                       // JSON array of feature strings
  maxTenantUsers: text('max_tenant_users').default('5'),
  maxConversationsPerMonth: text('max_conversations_per_month').default('1000'),
  hasForense: text('has_forense').default('true'),
  hasLiveOpp: text('has_live_opp').default('true'),
  hasWonTrack: text('has_won_track').default('true'),
  isActive: text('is_active').default('true'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id')
    .notNull()
    .references(() => plans.id),
  status: text('status').notNull().default('active'), // active, cancelled, past_due, trialing
  currentPeriodStart: timestamp('current_period_start').defaultNow().notNull(),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelledAt: timestamp('cancelled_at'),
  trialEndsAt: timestamp('trial_ends_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Usage tracking ─────────────────────────────────────────────────────

export const usageLog = pgTable('usage_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  periodKey: text('period_key').notNull(),        // e.g. "2026-06"
  conversationsAnalyzed: text('conversations_analyzed').notNull().default('0'),
  forenseRuns: text('forense_runs').notNull().default('0'),
  liveOppRuns: text('live_opp_runs').notNull().default('0'),
  wonTrackRuns: text('won_track_runs').notNull().default('0'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
