import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });
config();
import { drizzle } from "drizzle-orm/neon-http";
import { itEquipmentTypes, settings, users } from "./schema";

const DEFAULT_EQUIPMENT_TYPES = [
  { name: "Laptop", sortOrder: 10 },
  { name: "Maus", sortOrder: 20 },
  { name: "Kopfhörer", sortOrder: 30 },
  { name: "Peripherie", sortOrder: 40 },
  { name: "Rucksack", sortOrder: 50 },
  { name: "Koffer", sortOrder: 60 },
];

/**
 * Legt die Settings-Zeile mit den Startwerten aus dem Blatt "Sätze" an,
 * die Standard-Ausstattungsarten für das IT-Management und optional den
 * Admin-User (ADMIN_EMAIL / ADMIN_NAME aus der Umgebung).
 */
async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  await db
    .insert(settings)
    .values({ id: 1 })
    .onConflictDoNothing({ target: settings.id });
  console.log("Settings-Zeile mit Standardsätzen angelegt (falls fehlend).");

  await db
    .insert(itEquipmentTypes)
    .values(DEFAULT_EQUIPMENT_TYPES)
    .onConflictDoNothing({ target: itEquipmentTypes.name });
  console.log("Standard-Ausstattungsarten angelegt (falls fehlend).");

  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    const [firstName = "Stefan", lastName = "Müller"] = (
      process.env.ADMIN_NAME ?? "Stefan Müller"
    ).split(" ");
    await db
      .insert(users)
      .values({
        email: adminEmail,
        firstName,
        lastName,
        role: "admin",
        status: "aktiv",
        annualVacationDays: 30,
      })
      .onConflictDoNothing({ target: users.email });
    console.log(`Admin-User ${adminEmail} angelegt (falls fehlend).`);
  }
}

main().then(() => process.exit(0));
