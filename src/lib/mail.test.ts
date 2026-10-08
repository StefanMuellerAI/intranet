import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMail } from "./mail";

/**
 * Unit-Tests für den Brevo-Versand. Im Integrationsprojekt ist @/lib/mail
 * global gemockt — deshalb liegen diese Tests als Unit-Tests neben dem Modul.
 * fetch und Umgebungsvariablen werden je Testfall gestubbt.
 */

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

const fetchMock = vi.fn<typeof fetch>();
let log: ReturnType<typeof vi.spyOn>;
let fehlerLog: ReturnType<typeof vi.spyOn>;

function mail(overrides: Partial<Parameters<typeof sendMail>[0]> = {}) {
  return {
    to: [{ email: "erika.admin@stefanai.de", name: "Erika Admin" }],
    subject: "Urlaubsantrag eingereicht: Max Mitarbeiter",
    heading: "Urlaubsantrag eingereicht",
    paragraphs: ["Max Mitarbeiter hat einen neuen Antrag eingereicht.", "5 Urlaubstage."],
    linkPath: "/freigaben/urlaub/123",
    ...overrides,
  };
}

/** Body des letzten Brevo-Aufrufs */
function brevoBody() {
  const init = fetchMock.mock.calls.at(-1)?.[1];
  return JSON.parse(String(init?.body)) as {
    sender: { name: string; email: string };
    to: { email: string; name?: string }[];
    subject: string;
    htmlContent: string;
  };
}

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("BREVO_API_KEY", "xkeysib-test");
  vi.stubEnv("APP_BASE_URL", "https://intranet.stefanai.de");
  vi.stubEnv("MAIL_SENDER_NAME", undefined);
  vi.stubEnv("MAIL_SENDER_EMAIL", undefined);
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  fehlerLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  log.mockRestore();
  fehlerLog.mockRestore();
});

describe("sendMail — Brevo-Versand", () => {
  it("sendet Absender, Empfänger, Betreff und HTML mit API-Key an Brevo", async () => {
    await sendMail(mail());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(BREVO_URL);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "api-key": "xkeysib-test",
      "content-type": "application/json",
      accept: "application/json",
    });

    const body = brevoBody();
    expect(body.sender).toEqual({
      name: "StefanAI Intranet",
      email: "intranet@stefanai.de",
    });
    expect(body.to).toEqual([
      { email: "erika.admin@stefanai.de", name: "Erika Admin" },
    ]);
    expect(body.subject).toBe("Urlaubsantrag eingereicht: Max Mitarbeiter");
    expect(body.htmlContent).toContain("Urlaubsantrag eingereicht</h2>");
    expect(body.htmlContent).toContain(
      "Max Mitarbeiter hat einen neuen Antrag eingereicht.</p>"
    );
    expect(body.htmlContent).toContain("5 Urlaubstage.</p>");
    expect(body.htmlContent).toContain(
      'href="https://intranet.stefanai.de/freigaben/urlaub/123"'
    );
    expect(body.htmlContent).toContain("Vorgang öffnen</a>");
    expect(fehlerLog).not.toHaveBeenCalled();
  });

  it("übernimmt Absender aus der Umgebung und eine eigene Link-Beschriftung", async () => {
    vi.stubEnv("MAIL_SENDER_NAME", "HR StefanAI");
    vi.stubEnv("MAIL_SENDER_EMAIL", "hr@stefanai.de");

    await sendMail(mail({ linkLabel: "Zur Freigabe" }));

    const body = brevoBody();
    expect(body.sender).toEqual({ name: "HR StefanAI", email: "hr@stefanai.de" });
    expect(body.htmlContent).toContain("Zur Freigabe</a>");
    expect(body.htmlContent).not.toContain("Vorgang öffnen");
  });

  it("bevorzugt eine absolute linkUrl vor dem App-Pfad", async () => {
    await sendMail(
      mail({ linkUrl: "https://clerk.test/einladung?ticket=abc", linkPath: "/dashboard" })
    );
    const html = brevoBody().htmlContent;
    expect(html).toContain('href="https://clerk.test/einladung?ticket=abc"');
    expect(html).not.toContain("/dashboard");
  });

  it("nutzt ohne APP_BASE_URL localhost als Basis", async () => {
    vi.stubEnv("APP_BASE_URL", undefined);
    await sendMail(mail());
    expect(brevoBody().htmlContent).toContain(
      'href="http://localhost:3000/freigaben/urlaub/123"'
    );
  });

  it("lässt den Button ohne Link weg", async () => {
    await sendMail(mail({ linkPath: undefined }));
    const html = brevoBody().htmlContent;
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("Vorgang öffnen");
  });

  it("maskiert HTML in Überschrift, Absätzen und Link-Beschriftung", async () => {
    await sendMail(
      mail({
        heading: '<script>alert("x")</script> & Co',
        paragraphs: ["Begründung: <img src=x onerror=alert(1)>"],
        linkLabel: "<b>Öffnen</b>",
      })
    );
    const html = brevoBody().htmlContent;
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co"
    );
    expect(html).toContain("Begründung: &lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;b&gt;Öffnen&lt;/b&gt;</a>");
  });

  it("loggt eine Fehlerantwort von Brevo, ohne zu werfen", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"message":"invalid sender"}', { status: 400 })
    );

    await expect(sendMail(mail())).resolves.toBeUndefined();

    expect(fehlerLog).toHaveBeenCalledWith(
      'Brevo-Versand fehlgeschlagen (400): {"message":"invalid sender"}'
    );
  });

  it("reicht Netzwerkfehler an den Aufrufer weiter (aktuelles Verhalten)", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(sendMail(mail())).rejects.toThrow("fetch failed");
  });
});

describe("sendMail — ohne BREVO_API_KEY", () => {
  it("loggt in der Entwicklung nur Empfänger und Betreff, niemals den Link", async () => {
    vi.stubEnv("BREVO_API_KEY", undefined);
    vi.stubEnv("NODE_ENV", "development");

    await sendMail(
      mail({
        to: [{ email: "neu@stefanai.de" }, { email: "zweit@stefanai.de" }],
        subject: "Ihre Einladung zum StefanAI Intranet",
        linkUrl: "https://clerk.test/einladung?ticket=geheim-123",
      })
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fehlerLog).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    const ausgabe = String(log.mock.calls[0][0]);
    expect(ausgabe).toBe(
      "[Mail-Stub] An: neu@stefanai.de, zweit@stefanai.de — Betreff: Ihre Einladung zum StefanAI Intranet"
    );
    expect(ausgabe).not.toContain("geheim-123");
  });

  it("meldet in Produktion einen Konfigurationsfehler, ohne zu werfen", async () => {
    vi.stubEnv("BREVO_API_KEY", undefined);
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      sendMail(
        mail({
          to: [{ email: "a@stefanai.de" }, { email: "b@stefanai.de" }],
          linkUrl: "https://clerk.test/einladung?ticket=geheim-456",
        })
      )
    ).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(fehlerLog).toHaveBeenCalledTimes(1);
    const meldung = String(fehlerLog.mock.calls[0][0]);
    expect(meldung).toContain("BREVO_API_KEY fehlt");
    expect(meldung).toContain("2 Empfänger:in(nen)");
    expect(meldung).toContain("Betreff: Urlaubsantrag eingereicht: Max Mitarbeiter");
    expect(meldung).not.toContain("geheim-456");
    expect(meldung).not.toContain("a@stefanai.de");
  });
});
