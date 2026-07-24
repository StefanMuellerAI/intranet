ALTER TABLE "users" ADD COLUMN "technical_supervisor_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disciplinary_supervisor_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_technical_supervisor_id_users_id_fk" FOREIGN KEY ("technical_supervisor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_disciplinary_supervisor_id_users_id_fk" FOREIGN KEY ("disciplinary_supervisor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;