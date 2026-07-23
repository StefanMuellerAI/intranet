CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	"rate_window_start" timestamp,
	"rate_window_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid,
	"action" text NOT NULL,
	"actor_user_id" uuid,
	"actor_label" text NOT NULL,
	"source" text NOT NULL,
	"api_key_id" uuid,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deputy_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"item_date" date,
	"absence_type" text,
	"breakfast_provided" boolean DEFAULT false NOT NULL,
	"lunch_provided" boolean DEFAULT false NOT NULL,
	"dinner_provided" boolean DEFAULT false NOT NULL,
	"gross_cents" integer DEFAULT 0 NOT NULL,
	"reduction_cents" integer DEFAULT 0 NOT NULL,
	"net_cents" integer DEFAULT 0 NOT NULL,
	"description" text,
	"amount_cents" integer,
	"kilometers" double precision,
	"passengers" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'eingereicht' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"destination" text NOT NULL,
	"customer_purpose" text NOT NULL,
	"departure_date" date NOT NULL,
	"departure_time" text NOT NULL,
	"return_date" date NOT NULL,
	"return_time" text NOT NULL,
	"is_abroad" boolean DEFAULT false NOT NULL,
	"rates_snapshot" jsonb,
	"meal_allowance_cents" integer DEFAULT 0 NOT NULL,
	"transport_cents" integer DEFAULT 0 NOT NULL,
	"car_cents" integer DEFAULT 0 NOT NULL,
	"lodging_cents" integer DEFAULT 0 NOT NULL,
	"incidentals_cents" integer DEFAULT 0 NOT NULL,
	"employer_supplement_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"rejection_comment" text,
	"decided_by_id" uuid,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"item_id" uuid,
	"user_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"blob_url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_type" text NOT NULL,
	"request_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"default_annual_vacation_days" double precision DEFAULT 30 NOT NULL,
	"workation_yearly_limit_days" integer DEFAULT 30 NOT NULL,
	"workation_consecutive_limit_days" integer DEFAULT 20 NOT NULL,
	"rate_full_day_cents" integer DEFAULT 2800 NOT NULL,
	"rate_partial_day_cents" integer DEFAULT 1400 NOT NULL,
	"rate_reduction_breakfast_cents" integer DEFAULT 560 NOT NULL,
	"rate_reduction_lunch_cents" integer DEFAULT 1120 NOT NULL,
	"rate_reduction_dinner_cents" integer DEFAULT 1120 NOT NULL,
	"rate_km_cents" integer DEFAULT 30 NOT NULL,
	"rate_passenger_km_cents" integer DEFAULT 2 NOT NULL,
	"employer_daily_supplement_cents" integer DEFAULT 0 NOT NULL,
	"retention_expense_years" integer DEFAULT 8 NOT NULL,
	"retention_sick_leave_years" integer DEFAULT 5 NOT NULL,
	"retention_request_years" integer DEFAULT 3 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sick_leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'gemeldet' NOT NULL,
	"type" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" text,
	"clerk_invitation_id" text,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"role" text DEFAULT 'mitarbeiter' NOT NULL,
	"status" text DEFAULT 'eingeladen' NOT NULL,
	"annual_vacation_days" double precision NOT NULL,
	"vacation_carryover_days" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vacation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'eingereicht' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"half_day_start" boolean DEFAULT false NOT NULL,
	"half_day_end" boolean DEFAULT false NOT NULL,
	"days" double precision NOT NULL,
	"substitute_user_id" uuid,
	"substitute_text" text,
	"note" text,
	"rejection_comment" text,
	"decided_by_id" uuid,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"event" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'ausstehend' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"next_retry_at" timestamp,
	"response_status" integer,
	"response_body" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'eingereicht' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"country" text NOT NULL,
	"country_category" text NOT NULL,
	"city" text NOT NULL,
	"accommodation_address" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"work_days" double precision NOT NULL,
	"vacation_days" double precision DEFAULT 0 NOT NULL,
	"timezone_availability" text NOT NULL,
	"days_in_country_this_year" integer DEFAULT 0 NOT NULL,
	"emergency_contact_name" text NOT NULL,
	"emergency_contact_phone" text NOT NULL,
	"visa_type" text NOT NULL,
	"visa_valid_until" date,
	"insurance_details" text NOT NULL,
	"proof_provided_at" date,
	"planned_tasks" text NOT NULL,
	"excluded_projects" text,
	"domestic_substitution" text NOT NULL,
	"decl_residence" boolean DEFAULT false NOT NULL,
	"decl_visa" boolean DEFAULT false NOT NULL,
	"decl_working_time" boolean DEFAULT false NOT NULL,
	"decl_data_protection" boolean DEFAULT false NOT NULL,
	"decl_no_forbidden_activities" boolean DEFAULT false NOT NULL,
	"decl_report_changes" boolean DEFAULT false NOT NULL,
	"decl_costs" boolean DEFAULT false NOT NULL,
	"a1_status" text,
	"rejection_comment" text,
	"decided_by_id" uuid,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deputy_assignments" ADD CONSTRAINT "deputy_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_report_id_expense_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."expense_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_report_id_expense_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."expense_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_item_id_expense_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."expense_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sick_leaves" ADD CONSTRAINT "sick_leaves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_requests" ADD CONSTRAINT "vacation_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_requests" ADD CONSTRAINT "vacation_requests_substitute_user_id_users_id_fk" FOREIGN KEY ("substitute_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_requests" ADD CONSTRAINT "vacation_requests_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_config_id_webhook_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."webhook_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workation_requests" ADD CONSTRAINT "workation_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workation_requests" ADD CONSTRAINT "workation_requests_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;