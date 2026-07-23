CREATE TABLE "employee_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text DEFAULT 'sonstiges' NOT NULL,
	"title" text,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"blob_url" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"uploaded_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;