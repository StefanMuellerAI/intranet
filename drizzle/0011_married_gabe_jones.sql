ALTER TABLE "it_equipment" ADD COLUMN "device_id" text;--> statement-breakpoint
-- Bestandsgeräte erhalten fortlaufende Platzhalter (IT-0001, IT-0002, …), die
-- der Admin danach in der Oberfläche auf die echten Inventar-IDs ändert.
-- Erst danach lassen sich NOT NULL und die Eindeutigkeit setzen.
UPDATE "it_equipment" AS e
SET "device_id" = 'IT-' || lpad(n.rn::text, 4, '0')
FROM (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn
  FROM "it_equipment"
) AS n
WHERE e."id" = n."id";--> statement-breakpoint
ALTER TABLE "it_equipment" ALTER COLUMN "device_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "it_equipment" ADD CONSTRAINT "it_equipment_device_id_unique" UNIQUE("device_id");
