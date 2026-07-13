ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "agent_autonomy" text;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "ghl_agent_user_id" text;
