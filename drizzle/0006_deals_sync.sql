CREATE TABLE IF NOT EXISTS "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"ghl_id" text NOT NULL,
	"status" text NOT NULL,
	"monetary_value" text DEFAULT '0' NOT NULL,
	"contact_name" text,
	"pipeline_stage_name" text,
	"lost_reason_id" text,
	"ghl_created_at" timestamp,
	"last_stage_change_at" timestamp,
	"ghl_updated_at" timestamp,
	"payload" text NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "deals_tenant_ghl_unique" UNIQUE("tenant_id","ghl_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"deal_ghl_id" text NOT NULL,
	"conversation_id" text,
	"payload" text NOT NULL,
	"message_count" text DEFAULT '0' NOT NULL,
	"last_message_at" timestamp,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "deal_messages_tenant_deal_unique" UNIQUE("tenant_id","deal_ghl_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_tenant_status_idx" ON "deals" ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_messages_tenant_idx" ON "deal_messages" ("tenant_id");
