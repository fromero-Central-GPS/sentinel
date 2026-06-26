CREATE TABLE "usage_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"conversations_analyzed" text DEFAULT '0' NOT NULL,
	"forense_runs" text DEFAULT '0' NOT NULL,
	"live_opp_runs" text DEFAULT '0' NOT NULL,
	"won_track_runs" text DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_log" ADD CONSTRAINT "usage_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;