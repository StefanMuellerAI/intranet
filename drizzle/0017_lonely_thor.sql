CREATE TABLE "seminar_report_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"quote" text NOT NULL,
	"website_approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seminar_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"customer_name" text NOT NULL,
	"title" text NOT NULL,
	"event_date" date NOT NULL,
	"duration_days" double precision NOT NULL,
	"what_went_well" text NOT NULL,
	"what_went_badly" text NOT NULL,
	"improvements" text NOT NULL,
	"feedback_rating" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seminar_report_quotes" ADD CONSTRAINT "seminar_report_quotes_report_id_seminar_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."seminar_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seminar_reports" ADD CONSTRAINT "seminar_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seminar_reports_user_event_idx" ON "seminar_reports" USING btree ("user_id","event_date");