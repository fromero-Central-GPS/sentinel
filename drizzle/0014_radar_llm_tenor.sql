ALTER TABLE "radar_conversations" ADD COLUMN IF NOT EXISTS "llm_tipo" text;
--> statement-breakpoint
ALTER TABLE "radar_conversations" ADD COLUMN IF NOT EXISTS "llm_es_cliente" text;
--> statement-breakpoint
ALTER TABLE "radar_conversations" ADD COLUMN IF NOT EXISTS "llm_confianza" text;
--> statement-breakpoint
ALTER TABLE "radar_conversations" ADD COLUMN IF NOT EXISTS "llm_motivo" text;
--> statement-breakpoint
ALTER TABLE "radar_conversations" ADD COLUMN IF NOT EXISTS "llm_classified_at" timestamp;
--> statement-breakpoint
ALTER TABLE "radar_conversations" ADD COLUMN IF NOT EXISTS "tag_changes" text;
