CREATE TABLE "sales_news_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_news_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_news_dismissals" ADD CONSTRAINT "sales_news_dismissals_sales_news_id_sales_news_id_fk" FOREIGN KEY ("sales_news_id") REFERENCES "public"."sales_news"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_news_dismissals" ADD CONSTRAINT "sales_news_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_news_dismissals_item_user_idx" ON "sales_news_dismissals" USING btree ("sales_news_id","user_id");