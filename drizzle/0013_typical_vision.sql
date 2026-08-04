ALTER TABLE "it_equipment_documents" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "it_equipment_documents" ADD COLUMN "kind" text NOT NULL;--> statement-breakpoint
ALTER TABLE "it_equipment_documents" ADD CONSTRAINT "it_equipment_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "it_equipment_documents_user_kind_idx" ON "it_equipment_documents" USING btree ("user_id","kind");