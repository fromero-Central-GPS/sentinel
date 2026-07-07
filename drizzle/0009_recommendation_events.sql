CREATE TABLE IF NOT EXISTS "recommendation_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "deal_ghl_id" text NOT NULL,
  "contact_id" text,
  "engine" text NOT NULL,
  "action" text NOT NULL,
  "reason" text,
  "status_at_event" text,
  "value_at_event" text,
  "payload" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_tenant_idx" ON "recommendation_events" ("tenant_id");
