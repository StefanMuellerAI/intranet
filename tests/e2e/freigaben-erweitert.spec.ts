import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import {
  commissionClaims,
  deputyAssignments,
  expenseReports,
  users,
  vacationRequests,
  workationRequests,
} from "../../src/db/schema";
import { E2E_ADMIN_EMAIL, E2E_USER_EMAIL, testDb } from "../helpers/db";
import {
  ADMIN_NAME,
  ADMIN_STATE,
  USER_NAME,
  USER_STATE,
  clickNav,
  expectToast,
  openDialog,
  pageAs,
  statusBadge,
} from "./helpers";

/*
 * Ergänzt die Freigabe-Abläufe (Testplan 5.5 „Freigaben“): Beanstanden für
 * Workation, Reisekosten und Provision, „Storno ablehnen“, Workation-
 * Adminfelder und die eingeschränkte Ansicht der Vertretung. Die Anträge
 * werden direkt in der DB angelegt (der Einreichungs-Flow ist anderswo
 * abgedeckt); alle Zeiträume liegen in 2027.
 */

const pages: Page[] = [];

async function open(browser: Browser, state: string): Promise<Page> {
  const page = await pageAs(browser, state);
  pages.push(page);
  return page;
}

test.afterEach(async () => {
  for (const page of pages.splice(0))
    await page.context().close().catch(() => {});
});

async function userId(email: string): Promise<string> {
  const [user] = await testDb()
    .select()
    .from(users)
    .where(eq(users.email, email));
  if (!user) throw new Error(`Test-User ${email} fehlt in der Datenbank.`);
  return user.id;
}

/** Betrag wie in der App formatiert (formatEuro). */
function euro(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

/** Wert eines <dt>/<dd>-Paars in den Antragsdetails. */
function detail(scope: Page | Locator, label: string): Locator {
  return scope.locator(`div:has(> dt:text-is("${label}")) > dd`);
}

/** „Prüfen“-Link der Freigaben-Liste für genau diesen Antrag. */
function pruefenLink(page: Page, type: string, id: string): Locator {
  return page
    .getByRole("row")
    .filter({ has: page.locator(`a[href="/freigaben/${type}/${id}"]`) })
    .getByRole("link", { name: "Prüfen" });
}

/** Sidebar-Link „Freigaben“ (Name enthält die Zahl offener Anträge). */
async function navToFreigaben(page: Page): Promise<void> {
  await page
    .getByRole("navigation")
    .first()
    .getByRole("link", { name: /^Freigaben/ })
    .click();
  await expect(page).toHaveURL(/\/freigaben$/, { timeout: 30_000 });
}

/** Beanstanden bzw. Storno ablehnen über den Dialog mit Pflicht-Kommentar. */
async function rejectWithComment(
  page: Page,
  trigger: "Beanstanden" | "Storno ablehnen",
  dialogTitle: string,
  comment: string
): Promise<void> {
  const dialog = page.getByRole("dialog");
  await openDialog(
    page.getByRole("main").getByRole("button", { name: trigger, exact: true }),
    dialog
  );
  await expect(
    dialog.getByRole("heading", { name: dialogTitle, exact: true })
  ).toBeVisible();
  const send = dialog.getByRole("button", { name: "Beanstandung senden" });
  await expect(send).toBeDisabled();
  await dialog.locator("#comment").fill(comment);
  await expect(send).toBeEnabled();
  await send.click();
  await expectToast(page, "Beanstandung gesendet.");
  await expect(dialog).toBeHidden();
}

type WorkationInsert = typeof workationRequests.$inferInsert;

/** Vollständig ausgefüllter Workation-Antrag für Direkt-Inserts. */
function workationFixture(
  userId: string,
  values: Pick<
    WorkationInsert,
    "country" | "countryCategory" | "city" | "startDate" | "endDate" | "workDays"
  > &
    Partial<WorkationInsert>
): WorkationInsert {
  return {
    userId,
    accommodationAddress: "Testanschrift 1",
    vacationDays: 0,
    timezoneAvailability: "MEZ, erreichbar 9–17 Uhr",
    daysInCountryThisYear: 0,
    emergencyContactName: "Maria Mitarbeiter",
    emergencyContactPhone: "+49 221 987654",
    visaType: "keins (EU-Freizügigkeit)",
    insuranceDetails: "Envivas Auslandsschutz, Police 12345",
    plannedTasks: "Projektarbeit",
    domesticSubstitution: "Kollegin übernimmt Termine vor Ort.",
    declResidence: true,
    declVisa: true,
    declWorkingTime: true,
    declDataProtection: true,
    declNoForbiddenActivities: true,
    declReportChanges: true,
    declCosts: true,
    ...values,
  };
}

test.describe("Freigaben — erweiterte Bedienelemente", () => {
  test.describe.configure({ timeout: 120_000 });

  test("Beanstanden mit Pflicht-Kommentar für Workation, Reisekosten und Provision", async ({
    browser,
  }) => {
    const db = testDb();
    const employeeId = await userId(E2E_USER_EMAIL);
    const stamp = Date.now();

    const [workation] = await db
      .insert(workationRequests)
      .values(
        workationFixture(employeeId, {
          country: "Italien",
          countryCategory: "eu_ewr_ch",
          city: `Bologna E2E-${stamp}`,
          startDate: "2027-11-08",
          endDate: "2027-11-09",
          workDays: 2,
        })
      )
      .returning();
    const [expense] = await db
      .insert(expenseReports)
      .values({
        userId: employeeId,
        destination: `Hamburg E2E-${stamp}`,
        customerPurpose: "Kundentermin",
        departureDate: "2027-11-15",
        departureTime: "08:00",
        returnDate: "2027-11-15",
        returnTime: "19:00",
        mealAllowanceCents: 1_400,
        totalCents: 1_400,
      })
      .returning();
    const [claim] = await db
      .insert(commissionClaims)
      .values({
        userId: employeeId,
        businessType: "schulung",
        customerType: "bestandskunde",
        customerName: `E2E Beanstandung ${stamp}`,
        orderDate: "2027-11-01",
        unit: "tage",
        quantity: 1,
        trainingFormat: "ganztaegig",
        trainingCount: 1,
        calculatedAmountCents: 7_500,
        finalAmountCents: 7_500,
      })
      .returning();

    const cases = [
      {
        type: "workation",
        id: workation.id,
        heading: `Workation: ${USER_NAME}`,
        comment: `Bitte Unterkunft konkretisieren (E2E-${stamp})`,
        load: async () =>
          (
            await db
              .select()
              .from(workationRequests)
              .where(eq(workationRequests.id, workation.id))
          )[0],
      },
      {
        type: "reisekosten",
        id: expense.id,
        heading: `Reisekosten: ${USER_NAME} · ${euro(1_400)}`,
        comment: `Bitte Fahrtkosten-Beleg ergänzen (E2E-${stamp})`,
        load: async () =>
          (
            await db
              .select()
              .from(expenseReports)
              .where(eq(expenseReports.id, expense.id))
          )[0],
      },
      {
        type: "provision",
        id: claim.id,
        heading: `Provision: ${USER_NAME} · ${euro(7_500)}`,
        comment: `Bitte Bestellnachweis nachreichen (E2E-${stamp})`,
        load: async () =>
          (
            await db
              .select()
              .from(commissionClaims)
              .where(eq(commissionClaims.id, claim.id))
          )[0],
      },
    ];

    const admin = await open(browser, ADMIN_STATE);
    await admin.goto("/freigaben");
    for (const [index, c] of cases.entries()) {
      if (index > 0) await navToFreigaben(admin);
      await pruefenLink(admin, c.type, c.id).click();
      await expect(admin).toHaveURL(
        new RegExp(`/freigaben/${c.type}/${c.id}$`),
        { timeout: 30_000 }
      );
      await expect(
        admin.getByRole("heading", { name: c.heading, exact: true })
      ).toBeVisible();
      await expect(statusBadge(admin, "Eingereicht")).toBeVisible();

      await rejectWithComment(admin, "Beanstanden", "Antrag beanstanden", c.comment);
      await expect(statusBadge(admin, "Beanstandet")).toBeVisible();
      await expect(
        admin.getByText("Dieser Vorgang ist bereits entschieden.")
      ).toBeVisible();

      const saved = await c.load();
      expect(saved.status).toBe("beanstandet");
      expect(saved.rejectionComment).toBe(c.comment);
    }

    // Der Mitarbeiter sieht Status und Begründung und kann korrigieren
    const employee = await open(browser, USER_STATE);
    await employee.goto("/workation");
    await employee.locator(`a[href="/workation/${workation.id}"]`).click();
    await expect(statusBadge(employee, "Beanstandet")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      employee.getByText(cases[0].comment, { exact: true })
    ).toBeVisible();
    await expect(
      employee.getByText("Antrag korrigieren und erneut einreichen", {
        exact: true,
      })
    ).toBeVisible();

    await clickNav(employee, "Reisekosten");
    await employee.locator(`a[href="/reisekosten/${expense.id}"]`).click();
    await expect(statusBadge(employee, "Beanstandet")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      employee.getByText(cases[1].comment, { exact: true })
    ).toBeVisible();
    await expect(
      employee.getByText("Abrechnung korrigieren und erneut einreichen", {
        exact: true,
      })
    ).toBeVisible();

    await clickNav(employee, "Provisionen");
    await employee.locator(`a[href="/provision/${claim.id}"]`).click();
    await expect(statusBadge(employee, "Beanstandet")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      employee.getByText(cases[2].comment, { exact: true })
    ).toBeVisible();
    await expect(
      employee.getByText("Anspruch korrigieren und erneut einreichen", {
        exact: true,
      })
    ).toBeVisible();
  });

  test("„Storno ablehnen“ lässt den Urlaub genehmigt", async ({ browser }) => {
    const db = testDb();
    const adminId = await userId(E2E_ADMIN_EMAIL);
    const employeeId = await userId(E2E_USER_EMAIL);
    const comment = `Storno nicht möglich, Projektphase (E2E-${Date.now()})`;
    // Genehmigter Urlaub Mo 07.06. – Mi 09.06.2027 mit beantragtem Storno
    const [request] = await db
      .insert(vacationRequests)
      .values({
        userId: employeeId,
        status: "storno_beantragt",
        startDate: "2027-06-07",
        endDate: "2027-06-09",
        days: 3,
        decidedById: adminId,
        decidedAt: new Date(),
      })
      .returning();

    const admin = await open(browser, ADMIN_STATE);
    await admin.goto("/freigaben");
    await pruefenLink(admin, "urlaub", request.id).click();
    await expect(admin).toHaveURL(
      new RegExp(`/freigaben/urlaub/${request.id}$`),
      { timeout: 30_000 }
    );
    await expect(
      admin.getByRole("heading", { name: `Urlaub: ${USER_NAME}`, exact: true })
    ).toBeVisible();
    await expect(statusBadge(admin, "Storno beantragt")).toBeVisible();
    await expect(
      admin.getByRole("button", { name: "Storno bestätigen" })
    ).toBeVisible();

    await rejectWithComment(admin, "Storno ablehnen", "Storno ablehnen", comment);
    await expect(statusBadge(admin, "Genehmigt")).toBeVisible();
    await expect(
      admin.getByText("Dieser Vorgang ist bereits entschieden.")
    ).toBeVisible();
    await expect(
      admin.getByText("storno abgelehnt", { exact: true })
    ).toBeVisible();

    const [saved] = await db
      .select()
      .from(vacationRequests)
      .where(eq(vacationRequests.id, request.id));
    expect(saved).toMatchObject({
      status: "genehmigt",
      rejectionComment: comment,
    });

    // Für den Mitarbeiter bleibt der Urlaub genehmigt (Storno erneut möglich)
    const employee = await open(browser, USER_STATE);
    await employee.goto("/urlaub");
    await employee.locator(`a[href="/urlaub/${request.id}"]`).click();
    await expect(statusBadge(employee, "Genehmigt")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      employee.getByRole("button", { name: "Stornierung beantragen" })
    ).toBeVisible();
  });

  test("Workation-Adminfelder (A1, Nachweise, ausgeschlossene Projekte) → „Felder speichern“", async ({
    browser,
  }) => {
    const db = testDb();
    const employeeId = await userId(E2E_USER_EMAIL);
    const stamp = Date.now();
    const excluded = `Mandat Muster GmbH (EU-Beschränkung) E2E-${stamp}`;
    const [euRequest] = await db
      .insert(workationRequests)
      .values(
        workationFixture(employeeId, {
          country: "Österreich",
          countryCategory: "eu_ewr_ch",
          city: `Salzburg E2E-${stamp}`,
          startDate: "2027-11-22",
          endDate: "2027-11-22",
          workDays: 1,
          a1Status: "nicht_beantragt",
        })
      )
      .returning();
    const [thirdCountryRequest] = await db
      .insert(workationRequests)
      .values(
        workationFixture(employeeId, {
          country: "Kanada",
          countryCategory: "drittstaat",
          city: `Toronto E2E-${stamp}`,
          startDate: "2027-11-24",
          endDate: "2027-11-24",
          workDays: 1,
          visaType: "eTA",
        })
      )
      .returning();

    const admin = await open(browser, ADMIN_STATE);
    await admin.goto("/freigaben");

    // EU-Antrag: A1-Status, Nachweisdatum und ausgeschlossene Projekte pflegen
    await pruefenLink(admin, "workation", euRequest.id).click();
    await expect(admin).toHaveURL(
      new RegExp(`/freigaben/workation/${euRequest.id}$`),
      { timeout: 30_000 }
    );
    await expect(
      admin.getByText("Vom Admin zu pflegende Felder", { exact: true })
    ).toBeVisible();
    await expect(
      admin.getByText(
        "A1-relevante Daten (Übertrag SV-Meldeportal / Lohnabrechnung)",
        { exact: true }
      )
    ).toBeVisible();
    await expect(
      admin.getByText("A1-Bescheinigung: nicht beantragt", { exact: true })
    ).toBeVisible();
    await expect(admin.locator("#a1Status")).toHaveValue("nicht_beantragt");
    await admin.locator("#a1Status").selectOption("liegt_vor");
    await admin.locator("#proofProvidedAt").fill("2027-11-01");
    await admin.locator("#excludedProjects").fill(excluded);
    await admin.getByRole("button", { name: "Felder speichern" }).click();

    await expect(
      admin.getByText("A1-Bescheinigung: liegt vor", { exact: true })
    ).toBeVisible();
    await expect(detail(admin, "Nachweise vorgelegt am")).toHaveText(
      "01.11.2027"
    );
    await expect(
      detail(admin, "Ausgeschlossene Projekte / Mandate (EU-Beschränkung)")
    ).toHaveText(excluded);
    await expect(
      admin.getByText("admin felder aktualisiert", { exact: true })
    ).toBeVisible();
    await expect
      .poll(async () => {
        const [row] = await db
          .select()
          .from(workationRequests)
          .where(eq(workationRequests.id, euRequest.id));
        return [row.a1Status, row.proofProvidedAt, row.excludedProjects];
      })
      .toEqual(["liegt_vor", "2027-11-01", excluded]);

    // Drittstaat: kein A1-Feld, Nachweisdatum lässt sich dennoch pflegen
    await navToFreigaben(admin);
    await pruefenLink(admin, "workation", thirdCountryRequest.id).click();
    await expect(admin).toHaveURL(
      new RegExp(`/freigaben/workation/${thirdCountryRequest.id}$`),
      { timeout: 30_000 }
    );
    await expect(
      admin.getByText("Vom Admin zu pflegende Felder", { exact: true })
    ).toBeVisible();
    await expect(admin.locator("#a1Status")).toHaveCount(0);
    await expect(
      admin.getByText(
        "A1-relevante Daten (Übertrag SV-Meldeportal / Lohnabrechnung)",
        { exact: true }
      )
    ).toHaveCount(0);
    await admin.locator("#proofProvidedAt").fill("2027-11-10");
    await admin.getByRole("button", { name: "Felder speichern" }).click();
    await expect(detail(admin, "Nachweise vorgelegt am")).toHaveText(
      "10.11.2027"
    );
    await expect
      .poll(async () => {
        const [row] = await db
          .select()
          .from(workationRequests)
          .where(eq(workationRequests.id, thirdCountryRequest.id));
        return [row.a1Status, row.proofProvidedAt];
      })
      .toEqual([null, "2027-11-10"]);

    // Der Mitarbeiter sieht die gepflegten Felder, aber kein Formular dafür
    const employee = await open(browser, USER_STATE);
    await employee.goto("/workation");
    await employee.locator(`a[href="/workation/${euRequest.id}"]`).click();
    await expect(
      employee.getByText("A1-Bescheinigung: liegt vor", { exact: true })
    ).toBeVisible({ timeout: 30_000 });
    await expect(detail(employee, "Nachweise vorgelegt am")).toHaveText(
      "01.11.2027"
    );
    await expect(
      detail(employee, "Ausgeschlossene Projekte / Mandate (EU-Beschränkung)")
    ).toHaveText(excluded);
    await expect(
      employee.getByRole("button", { name: "Felder speichern" })
    ).toHaveCount(0);
  });

  test("Die Vertretung sieht die Admin-Felder von Workation und Provision nicht", async ({
    browser,
  }) => {
    const db = testDb();
    const adminId = await userId(E2E_ADMIN_EMAIL);
    const employeeId = await userId(E2E_USER_EMAIL);
    const stamp = Date.now();

    // Offene Anträge des Admins, die die Vertretung entscheiden darf
    const [workation] = await db
      .insert(workationRequests)
      .values(
        workationFixture(adminId, {
          country: "Frankreich",
          countryCategory: "eu_ewr_ch",
          city: `Lyon E2E-${stamp}`,
          startDate: "2027-12-06",
          endDate: "2027-12-07",
          workDays: 2,
          a1Status: "nicht_beantragt",
        })
      )
      .returning();
    const [claim] = await db
      .insert(commissionClaims)
      .values({
        userId: adminId,
        businessType: "schulung",
        customerType: "neukunde",
        customerName: `E2E Vertretung ${stamp}`,
        orderDate: "2027-12-01",
        unit: "tage",
        quantity: 1,
        trainingFormat: "ganztaegig",
        trainingCount: 1,
        calculatedAmountCents: 7_500,
        finalAmountCents: 7_500,
      })
      .returning();

    // Mitarbeiter direkt in der DB zur aktiven Vertretung machen (global →
    // bisherigen Zustand merken und im finally wiederherstellen)
    const previouslyActive = await db
      .select()
      .from(deputyAssignments)
      .where(eq(deputyAssignments.active, true));
    let assignmentId: string | undefined;
    try {
      await db
        .update(deputyAssignments)
        .set({ active: false })
        .where(eq(deputyAssignments.active, true));
      const [assignment] = await db
        .insert(deputyAssignments)
        .values({ userId: employeeId, active: true })
        .returning();
      assignmentId = assignment.id;

      const deputy = await open(browser, USER_STATE);
      await deputy.goto("/freigaben");
      await expect(
        deputy.getByText("Vertretung (aktiv)").first()
      ).toBeVisible();

      // Workation: Entscheiden ja, Admin-Felder nein
      await pruefenLink(deputy, "workation", workation.id).click();
      await expect(deputy).toHaveURL(
        new RegExp(`/freigaben/workation/${workation.id}$`),
        { timeout: 30_000 }
      );
      await expect(
        deputy.getByRole("heading", {
          name: `Workation: ${ADMIN_NAME}`,
          exact: true,
        })
      ).toBeVisible();
      await expect(
        deputy.getByRole("button", { name: "Genehmigen" })
      ).toBeVisible();
      await expect(
        deputy.getByRole("button", { name: "Beanstanden" })
      ).toBeVisible();
      await expect(
        deputy.getByText("Vom Admin zu pflegende Felder", { exact: true })
      ).toHaveCount(0);
      await expect(
        deputy.getByRole("button", { name: "Felder speichern" })
      ).toHaveCount(0);
      await expect(
        deputy.locator("#a1Status, #proofProvidedAt, #excludedProjects")
      ).toHaveCount(0);
      await expect(
        deputy.getByText(
          "A1-relevante Daten (Übertrag SV-Meldeportal / Lohnabrechnung)",
          { exact: true }
        )
      ).toHaveCount(0);

      // Provision: Entscheiden ja, Beträge pflegen nein
      await navToFreigaben(deputy);
      await pruefenLink(deputy, "provision", claim.id).click();
      await expect(deputy).toHaveURL(
        new RegExp(`/freigaben/provision/${claim.id}$`),
        { timeout: 30_000 }
      );
      await expect(
        deputy.getByRole("heading", {
          name: `Provision: ${ADMIN_NAME} · ${euro(7_500)}`,
          exact: true,
        })
      ).toBeVisible();
      await expect(
        deputy.getByRole("button", { name: "Genehmigen" })
      ).toBeVisible();
      await expect(
        deputy.getByText("Vom Admin zu pflegende Beträge", { exact: true })
      ).toHaveCount(0);
      await expect(
        deputy.getByRole("button", { name: "Beträge speichern" })
      ).toHaveCount(0);
      await expect(
        deputy.locator("#finalAmount, #referralBonus")
      ).toHaveCount(0);

      // Gegenprobe: der Admin sieht die Felder auf demselben Antrag
      const admin = await open(browser, ADMIN_STATE);
      await admin.goto(`/freigaben/workation/${workation.id}`);
      await expect(
        admin.getByRole("button", { name: "Felder speichern" })
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        admin.getByText(
          "Eigene Anträge dürfen nicht selbst genehmigt werden (Vier-Augen-Prinzip)."
        )
      ).toBeVisible();
    } finally {
      if (assignmentId)
        await db
          .delete(deputyAssignments)
          .where(eq(deputyAssignments.id, assignmentId));
      if (previouslyActive.length > 0)
        await db
          .update(deputyAssignments)
          .set({ active: true })
          .where(
            inArray(
              deputyAssignments.id,
              previouslyActive.map((a) => a.id)
            )
          );
      // Offene Admin-Anträge wieder entfernen (Freigaben-Liste/Zähler)
      await db
        .delete(workationRequests)
        .where(eq(workationRequests.id, workation.id));
      await db
        .delete(commissionClaims)
        .where(eq(commissionClaims.id, claim.id));
    }
  });
});
