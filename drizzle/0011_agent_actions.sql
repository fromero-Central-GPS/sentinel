CREATE TABLE IF NOT EXISTS "agent_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "deal_ghl_id" text NOT NULL,
  "contact_id" text,
  "action" text NOT NULL,
  "params" text,
  "status" text DEFAULT 'proposed' NOT NULL,
  "decided_by" text DEFAULT 'playbook' NOT NULL,
  "approved_by" text,
  "executed_at" timestamp,
  "ghl_refs" text,
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_actions_tenant_idx" ON "agent_actions" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_actions_tenant_deal_idx" ON "agent_actions" ("tenant_id", "deal_ghl_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_ownership" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "deal_ghl_id" text NOT NULL,
  "owner" text NOT NULL,
  "reason" text,
  "actor" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_ownership_tenant_deal_idx" ON "deal_ownership" ("tenant_id", "deal_ghl_id");
