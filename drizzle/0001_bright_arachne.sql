CREATE TABLE "commission_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'eingereicht' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"business_type" text NOT NULL,
	"customer_type" text NOT NULL,
	"customer_name" text NOT NULL,
	"order_date" date NOT NULL,
	"unit" text NOT NULL,
	"quantity" double precision NOT NULL,
	"training_format" text,
	"training_count" integer,
	"net_order_value_cents" integer,
	"note" text,
	"rates_snapshot" jsonb,
	"calculated_amount_cents" integer,
	"referral_bonus_cents" integer,
	"final_amount_cents" integer,
	"rejection_comment" text,
	"decided_by_id" uuid,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "commission_half_day_cents" integer DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "commission_full_day_cents" integer DEFAULT 7500 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "commission_two_day_cents" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "commission_consulting_percent" double precision DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_claims" ADD CONSTRAINT "commission_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_claims" ADD CONSTRAINT "commission_claims_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;