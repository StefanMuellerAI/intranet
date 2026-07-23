import {
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Benutzer
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").unique(),
  clerkInvitationId: text("clerk_invitation_id"),
  email: text("email").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  role: text("role", { enum: ["admin", "mitarbeiter"] })
    .notNull()
    .default("mitarbeiter"),
  status: text("status", { enum: ["eingeladen", "aktiv", "deaktiviert"] })
    .notNull()
    .default("eingeladen"),
  /** Individueller Jahresurlaubsanspruch in Tagen (0,5er-Schritte möglich) */
  annualVacationDays: doublePrecision("annual_vacation_days").notNull(),
  /** Manueller Übertrag aus dem Vorjahr in Tagen */
  vacationCarryoverDays: doublePrecision("vacation_carryover_days")
    .notNull()
    .default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Mitarbeiterdokumente (Arbeitsverträge etc.) — verschlüsselt im Blob-Store
// ---------------------------------------------------------------------------

export const DOCUMENT_CATEGORIES = [
  "arbeitsvertrag",
  "zusatzvereinbarung",
  "bescheinigung",
  "sonstiges",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const employeeDocuments = pgTable("employee_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  category: text("category", { enum: DOCUMENT_CATEGORIES })
    .notNull()
    .default("sonstiges"),
  /** Optionale Beschreibung, z. B. "Arbeitsvertrag vom 01.01.2026" */
  title: text("title"),
  filename: text("filename").notNull(),
  /** Original-MIME-Typ für die entschlüsselte Auslieferung */
  contentType: text("content_type").notNull(),
  /** Klartextgröße in Bytes */
  sizeBytes: integer("size_bytes").notNull(),
  /** URL des AES-256-GCM-verschlüsselten Payloads in Vercel Blob */
  blobUrl: text("blob_url").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  uploadedById: uuid("uploaded_by_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Vertretung
// ---------------------------------------------------------------------------

export const deputyAssignments = pgTable("deputy_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  active: boolean("active").notNull().default(true),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Urlaubsanträge
// ---------------------------------------------------------------------------

export const REQUEST_STATUS = [
  "eingereicht",
  "genehmigt",
  "beanstandet",
  "storno_beantragt",
  "storniert",
  "zurueckgezogen",
] as const;
export type RequestStatus = (typeof REQUEST_STATUS)[number];

export const vacationRequests = pgTable("vacation_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  status: text("status", { enum: REQUEST_STATUS })
    .notNull()
    .default("eingereicht"),
  version: integer("version").notNull().default(1),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  halfDayStart: boolean("half_day_start").notNull().default(false),
  halfDayEnd: boolean("half_day_end").notNull().default(false),
  /** Berechnete Anzahl Urlaubstage (ohne Wochenenden/Feiertage NRW) */
  days: doublePrecision("days").notNull(),
  /** Vertretung während der Abwesenheit: Userauswahl oder Freitext */
  substituteUserId: uuid("substitute_user_id").references(() => users.id),
  substituteText: text("substitute_text"),
  note: text("note"),
  rejectionComment: text("rejection_comment"),
  decidedById: uuid("decided_by_id").references(() => users.id),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Workation-Anträge
// ---------------------------------------------------------------------------

export const workationRequests = pgTable("workation_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  status: text("status", { enum: REQUEST_STATUS })
    .notNull()
    .default("eingereicht"),
  version: integer("version").notNull().default(1),
  // Angaben zur Person und zum Aufenthalt
  country: text("country").notNull(),
  countryCategory: text("country_category", {
    enum: ["eu_ewr_ch", "drittstaat"],
  }).notNull(),
  city: text("city").notNull(),
  accommodationAddress: text("accommodation_address").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  workDays: doublePrecision("work_days").notNull(),
  vacationDays: doublePrecision("vacation_days").notNull().default(0),
  timezoneAvailability: text("timezone_availability").notNull(),
  daysInCountryThisYear: integer("days_in_country_this_year")
    .notNull()
    .default(0),
  emergencyContactName: text("emergency_contact_name").notNull(),
  emergencyContactPhone: text("emergency_contact_phone").notNull(),
  // Aufenthaltsrecht und Versicherung
  visaType: text("visa_type").notNull(),
  visaValidUntil: date("visa_valid_until"),
  insuranceDetails: text("insurance_details").notNull(),
  /** Nachweise vorgelegt am — pflegt der Admin */
  proofProvidedAt: date("proof_provided_at"),
  // Tätigkeit im Aufenthaltszeitraum
  plannedTasks: text("planned_tasks").notNull(),
  /** EU-Beschränkung — trägt der Admin im Genehmigungsschritt ein */
  excludedProjects: text("excluded_projects"),
  domesticSubstitution: text("domestic_substitution").notNull(),
  // Erklärungen (7 Pflicht-Checkboxen)
  declResidence: boolean("decl_residence").notNull().default(false),
  declVisa: boolean("decl_visa").notNull().default(false),
  declWorkingTime: boolean("decl_working_time").notNull().default(false),
  declDataProtection: boolean("decl_data_protection").notNull().default(false),
  declNoForbiddenActivities: boolean("decl_no_forbidden_activities")
    .notNull()
    .default(false),
  declReportChanges: boolean("decl_report_changes").notNull().default(false),
  declCosts: boolean("decl_costs").notNull().default(false),
  // A1-Bescheinigung (nur EU/EWR/Schweiz)
  a1Status: text("a1_status", {
    enum: ["nicht_beantragt", "beantragt", "liegt_vor"],
  }),
  rejectionComment: text("rejection_comment"),
  decidedById: uuid("decided_by_id").references(() => users.id),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Reisekostenabrechnungen
// ---------------------------------------------------------------------------

export const expenseReports = pgTable("expense_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  status: text("status", { enum: REQUEST_STATUS })
    .notNull()
    .default("eingereicht"),
  version: integer("version").notNull().default(1),
  // Block 1 — Angaben zur Reise
  destination: text("destination").notNull(),
  customerPurpose: text("customer_purpose").notNull(),
  departureDate: date("departure_date").notNull(),
  departureTime: text("departure_time").notNull(), // HH:MM
  returnDate: date("return_date").notNull(),
  returnTime: text("return_time").notNull(), // HH:MM
  isAbroad: boolean("is_abroad").notNull().default(false),
  // Sätze-Snapshot zum Zeitpunkt der Einreichung (Cents)
  ratesSnapshot: jsonb("rates_snapshot"),
  // Block 6 — berechnete Summen in Cents
  mealAllowanceCents: integer("meal_allowance_cents").notNull().default(0),
  transportCents: integer("transport_cents").notNull().default(0),
  carCents: integer("car_cents").notNull().default(0),
  lodgingCents: integer("lodging_cents").notNull().default(0),
  incidentalsCents: integer("incidentals_cents").notNull().default(0),
  /** Freiwilliger Arbeitgeber-Zuschlag (pauschal versteuert) */
  employerSupplementCents: integer("employer_supplement_cents")
    .notNull()
    .default(0),
  totalCents: integer("total_cents").notNull().default(0),
  rejectionComment: text("rejection_comment"),
  decidedById: uuid("decided_by_id").references(() => users.id),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const expenseItems = pgTable("expense_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportId: uuid("report_id")
    .notNull()
    .references(() => expenseReports.id, { onDelete: "cascade" }),
  kind: text("kind", {
    enum: ["verpflegung", "fahrt", "pkw", "uebernachtung", "nebenkosten"],
  }).notNull(),
  position: integer("position").notNull().default(0),
  itemDate: date("item_date"),
  // Verpflegung
  absenceType: text("absence_type", {
    enum: ["ganzer_tag", "an_abreisetag", "ueber_8_std", "unter_8_std"],
  }),
  breakfastProvided: boolean("breakfast_provided").notNull().default(false),
  lunchProvided: boolean("lunch_provided").notNull().default(false),
  dinnerProvided: boolean("dinner_provided").notNull().default(false),
  grossCents: integer("gross_cents").notNull().default(0), // Grundsatz
  reductionCents: integer("reduction_cents").notNull().default(0), // Kürzung
  netCents: integer("net_cents").notNull().default(0), // Pauschale bzw. Betrag
  // Fahrt / Übernachtung / Nebenkosten
  description: text("description"),
  amountCents: integer("amount_cents"),
  // Privat-Pkw
  kilometers: doublePrecision("kilometers"),
  passengers: integer("passengers"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportId: uuid("report_id")
    .notNull()
    .references(() => expenseReports.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").references(() => expenseItems.id, {
    onDelete: "set null",
  }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  blobUrl: text("blob_url").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Provisionsansprüche
// ---------------------------------------------------------------------------

export const commissionClaims = pgTable("commission_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  status: text("status", { enum: REQUEST_STATUS })
    .notNull()
    .default("eingereicht"),
  version: integer("version").notNull().default(1),
  /** Art des Folgegeschäfts */
  businessType: text("business_type", {
    enum: ["beratung", "schulung"],
  }).notNull(),
  /** Komplett neuer Kunde (Vermittlung) oder über Bestandskunden/Partner */
  customerType: text("customer_type", {
    enum: ["neukunde", "bestandskunde"],
  }).notNull(),
  /** Kunde bzw. vorgelagerte Organisation (z. B. Haufe, dbb) */
  customerName: text("customer_name").notNull(),
  /** Datum der Bestellung bzw. des Zustandekommens */
  orderDate: date("order_date").notNull(),
  /** Messeinheit des Folgegeschäfts */
  unit: text("unit", { enum: ["tage", "liefergegenstaende"] }).notNull(),
  /** Umfang in der gewählten Einheit */
  quantity: doublePrecision("quantity").notNull(),
  // Schulung: Format bestimmt den Satz (50/75/100 € bzw. Pauschale)
  trainingFormat: text("training_format", {
    enum: ["halbtaegig", "ganztaegig", "zweitaegig", "abweichend"],
  }),
  trainingCount: integer("training_count"),
  // Beratung: 4 % vom Nettoauftragswert
  netOrderValueCents: integer("net_order_value_cents"),
  note: text("note"),
  /** Sätze-Snapshot zum Zeitpunkt der Einreichung */
  ratesSnapshot: jsonb("rates_snapshot"),
  /** Automatisch berechneter Anspruch (null bei abweichendem Format) */
  calculatedAmountCents: integer("calculated_amount_cents"),
  /** Vermittlungsprovision Neukunde — Einzelfall, pflegt der Admin */
  referralBonusCents: integer("referral_bonus_cents"),
  /** Finaler Betrag — vorbelegt mit Berechnung, Admin-Override möglich */
  finalAmountCents: integer("final_amount_cents"),
  rejectionComment: text("rejection_comment"),
  decidedById: uuid("decided_by_id").references(() => users.id),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Krankmeldungen
// ---------------------------------------------------------------------------

export const sickLeaves = pgTable("sick_leaves", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  status: text("status", { enum: ["gemeldet", "abgeschlossen"] })
    .notNull()
    .default("gemeldet"),
  type: text("type", { enum: ["eigene_erkrankung", "kind_krank"] }).notNull(),
  startDate: date("start_date").notNull(),
  /** Voraussichtliches bzw. tatsächliches Ende — kann offen bleiben */
  endDate: date("end_date"),
  /** Bemerkung — ausdrücklich keine Diagnosen/Krankheitsgründe */
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Historie und Audit-Log
// ---------------------------------------------------------------------------

export const REQUEST_TYPES = [
  "urlaub",
  "workation",
  "reisekosten",
  "provision",
] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const requestHistory = pgTable("request_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestType: text("request_type", { enum: REQUEST_TYPES }).notNull(),
  requestId: uuid("request_id").notNull(),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Betroffener Objekttyp */
  objectType: text("object_type").notNull(),
  objectId: uuid("object_id"),
  action: text("action").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  /** Anzeigename des Akteurs (bleibt auch nach User-Anonymisierung lesbar) */
  actorLabel: text("actor_label").notNull(),
  /** Kennzeichnung Web-Oberfläche vs. API (KI) vs. System */
  source: text("source", { enum: ["web", "api", "system"] }).notNull(),
  apiKeyId: uuid("api_key_id"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Webhooks (n8n)
// ---------------------------------------------------------------------------

export const WEBHOOK_CATEGORIES = [
  "urlaub",
  "workation",
  "reisekosten",
  "krankmeldung",
  "provision",
] as const;

export const WEBHOOK_EVENTS = [
  "eingereicht",
  "genehmigt",
  "beanstandet",
  "storniert",
  "gemeldet",
  "abgeschlossen",
] as const;

export const webhookConfigs = pgTable("webhook_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  category: text("category", { enum: WEBHOOK_CATEGORIES }).notNull(),
  event: text("event", { enum: WEBHOOK_EVENTS }).notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  configId: uuid("config_id")
    .notNull()
    .references(() => webhookConfigs.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status", {
    enum: ["ausstehend", "erfolgreich", "fehlgeschlagen"],
  })
    .notNull()
    .default("ausstehend"),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at"),
  nextRetryAt: timestamp("next_retry_at"),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// API-Keys
// ---------------------------------------------------------------------------

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  createdById: uuid("created_by_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
  lastUsedAt: timestamp("last_used_at"),
  rateWindowStart: timestamp("rate_window_start"),
  rateWindowCount: integer("rate_window_count").notNull().default(0),
});

// ---------------------------------------------------------------------------
// Einstellungen (eine Zeile, id = 1)
// ---------------------------------------------------------------------------

export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  /** Vorbelegung Jahresurlaub für neue Einladungen (Tage) */
  defaultAnnualVacationDays: doublePrecision("default_annual_vacation_days")
    .notNull()
    .default(30),
  /** Workation: max. Arbeitstage pro Kalenderjahr */
  workationYearlyLimitDays: integer("workation_yearly_limit_days")
    .notNull()
    .default(30),
  /** Workation: max. zusammenhängende Arbeitstage pro Aufenthalt */
  workationConsecutiveLimitDays: integer("workation_consecutive_limit_days")
    .notNull()
    .default(20),
  // Verpflegungspauschalen (Cents) — Startwerte aus Blatt "Sätze"
  rateFullDayCents: integer("rate_full_day_cents").notNull().default(2800),
  ratePartialDayCents: integer("rate_partial_day_cents")
    .notNull()
    .default(1400),
  rateReductionBreakfastCents: integer("rate_reduction_breakfast_cents")
    .notNull()
    .default(560),
  rateReductionLunchCents: integer("rate_reduction_lunch_cents")
    .notNull()
    .default(1120),
  rateReductionDinnerCents: integer("rate_reduction_dinner_cents")
    .notNull()
    .default(1120),
  /** Kilometerpauschale Privat-Pkw (Cents je km) */
  rateKmCents: integer("rate_km_cents").notNull().default(30),
  /** Zuschlag je mitgenommener Person (Cents je km) */
  ratePassengerKmCents: integer("rate_passenger_km_cents")
    .notNull()
    .default(2),
  /** Freiwilliger Arbeitgeber-Zuschlag je anspruchsberechtigtem Reisetag (Cents) */
  employerDailySupplementCents: integer("employer_daily_supplement_cents")
    .notNull()
    .default(0),
  // Provisionssätze (Vertragswerte als Standard)
  /** Folge-Training halbtägig (Cents je Training) */
  commissionHalfDayCents: integer("commission_half_day_cents")
    .notNull()
    .default(5000),
  /** Folge-Training ganztägig (Cents je Training) */
  commissionFullDayCents: integer("commission_full_day_cents")
    .notNull()
    .default(7500),
  /** Folge-Training zweitägig (Cents je Training) */
  commissionTwoDayCents: integer("commission_two_day_cents")
    .notNull()
    .default(10000),
  /** Folgeberatung: Prozentsatz vom Nettoauftragswert */
  commissionConsultingPercent: doublePrecision(
    "commission_consulting_percent"
  )
    .notNull()
    .default(4),
  // Aufbewahrungsfristen in Jahren (nach Ablauf des Kalenderjahres)
  retentionExpenseYears: integer("retention_expense_years")
    .notNull()
    .default(8),
  retentionSickLeaveYears: integer("retention_sick_leave_years")
    .notNull()
    .default(5),
  retentionRequestYears: integer("retention_request_years")
    .notNull()
    .default(3),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type EmployeeDocument = typeof employeeDocuments.$inferSelect;
export type VacationRequest = typeof vacationRequests.$inferSelect;
export type WorkationRequest = typeof workationRequests.$inferSelect;
export type ExpenseReport = typeof expenseReports.$inferSelect;
export type ExpenseItem = typeof expenseItems.$inferSelect;
export type Receipt = typeof receipts.$inferSelect;
export type SickLeave = typeof sickLeaves.$inferSelect;
export type CommissionClaim = typeof commissionClaims.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type DeputyAssignment = typeof deputyAssignments.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type WebhookConfig = typeof webhookConfigs.$inferSelect;
