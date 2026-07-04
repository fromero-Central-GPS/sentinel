ALTER TABLE "usage_log" ADD COLUMN IF NOT EXISTS "llm_tokens_input" text DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "usage_log" ADD COLUMN IF NOT EXISTS "llm_tokens_output" text DEFAULT '0' NOT NULL;
