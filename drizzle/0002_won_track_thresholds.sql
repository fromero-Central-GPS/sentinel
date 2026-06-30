CREATE TABLE "won_track_thresholds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"thresholds" text NOT NULL,
	"sample_size" text DEFAULT '0' NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "won_track_thresholds_tenant_id_unique" UNIQUE("tenant_id")
);
