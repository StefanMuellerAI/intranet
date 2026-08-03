CREATE TABLE "it_equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"serial_number" text,
	"notes" text,
	"handover_date" date NOT NULL,
	"return_date" date,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "it_equipment_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"blob_url" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"uploaded_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "it_equipment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "it_equipment_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "it_equipment" ADD CONSTRAINT "it_equipment_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_equipment" ADD CONSTRAINT "it_equipment_type_id_it_equipment_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."it_equipment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_equipment" ADD CONSTRAINT "it_equipment_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_equipment_documents" ADD CONSTRAINT "it_equipment_documents_equipment_id_it_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."it_equipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it_equipment_documents" ADD CONSTRAINT "it_equipment_documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "it_equipment_types" ("name", "sort_order") VALUES
	('Laptop', 10),
	('Maus', 20),
	('Kopfhörer', 30),
	('Peripherie', 40),
	('Rucksack', 50),
	('Koffer', 60)
ON CONFLICT ("name") DO NOTHING;