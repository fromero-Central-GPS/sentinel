CREATE TABLE IF NOT EXISTS "llm_analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"engine" text NOT NULL,
	"key" text NOT NULL,
	"payload" text NOT NULL,
	"model" text,
	"analyzed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "llm_analysis_tenant_engine_key_unique" UNIQUE("tenant_id","engine","key")
);
