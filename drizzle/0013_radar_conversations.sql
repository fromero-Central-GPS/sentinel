CREATE TABLE IF NOT EXISTS "radar_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"ghl_conversation_id" text NOT NULL,
	"contact_id" text,
	"contact_name" text,
	"phone" text,
	"email" text,
	"last_message_snippet" text,
	"last_message_direction" text,
	"last_message_at" timestamp,
	"last_inbound_at" timestamp,
	"unread_count" text DEFAULT '0' NOT NULL,
	"assigned_to" text,
	"owner_name" text,
	"buy_intent" text DEFAULT 'false' NOT NULL,
	"intent_signals" text,
	"has_opportunity" text DEFAULT 'false' NOT NULL,
	"status" text DEFAULT 'nuevo' NOT NULL,
	"classified_at" timestamp DEFAULT now() NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "radar_conv_tenant_conv_unique" UNIQUE("tenant_id","ghl_conversation_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radar_conv_tenant_status_idx" ON "radar_conversations" ("tenant_id","status");
