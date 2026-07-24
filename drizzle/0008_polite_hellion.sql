CREATE TABLE "faktura_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"contact_person" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "faktura_customers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "faktura_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"monthly_limit_minutes" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faktura_time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"duration_minutes" integer NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"visible_on_timesheet" boolean DEFAULT true NOT NULL,
	"overbooked" boolean DEFAULT false NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid NOT NULL,
	"updated_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faktura_timesheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"doc_number" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_draft" boolean DEFAULT false NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"filename" text NOT NULL,
	"blob_url" text NOT NULL,
	"sha256" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faktura_week_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iso_year" integer NOT NULL,
	"iso_week" integer NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"approved_at" timestamp,
	"approved_by_id" uuid,
	"revoke_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "faktura_projects" ADD CONSTRAINT "faktura_projects_customer_id_faktura_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."faktura_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faktura_time_entries" ADD CONSTRAINT "faktura_time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faktura_time_entries" ADD CONSTRAINT "faktura_time_entries_project_id_faktura_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."faktura_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faktura_time_entries" ADD CONSTRAINT "faktura_time_entries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faktura_time_entries" ADD CONSTRAINT "faktura_time_entries_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faktura_timesheets" ADD CONSTRAINT "faktura_timesheets_customer_id_faktura_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."faktura_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faktura_timesheets" ADD CONSTRAINT "faktura_timesheets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faktura_week_approvals" ADD CONSTRAINT "faktura_week_approvals_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "faktura_projects_customer_name_idx" ON "faktura_projects" USING btree ("customer_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "faktura_timesheets_doc_version_idx" ON "faktura_timesheets" USING btree ("doc_number","version");--> statement-breakpoint
CREATE UNIQUE INDEX "faktura_week_approvals_week_idx" ON "faktura_week_approvals" USING btree ("iso_year","iso_week");