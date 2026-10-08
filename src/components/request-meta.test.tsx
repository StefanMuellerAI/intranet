import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHistory } from "@/lib/history";
import { AuditTrail, HistoryCard } from "./request-meta";

// Server-Komponenten lesen direkt aus der DB — Query-Kette und Filter mocken
const dbMock = vi.hoisted(() => {
  const state = { rows: [] as unknown[] };
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(async () => state.rows),
  };
  return { state, query, select: vi.fn(() => query) };
});

vi.mock("@/db", () => ({
  db: { select: dbMock.select },
  auditLog: {
    objectType: "audit_log.object_type",
    objectId: "audit_log.object_id",
    createdAt: "audit_log.created_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  asc: (column: unknown) => ({ asc: column }),
}));

vi.mock("@/lib/history", () => ({ getHistory: vi.fn(async () => []) }));

const T1 = new Date(2026, 9, 1, 9, 15);
const T2 = new Date(2026, 9, 2, 14, 30);

function auditEntry(overrides: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    action: "eingereicht",
    actorLabel: "Anna Muster",
    source: "web",
    createdAt: T1,
    ...overrides,
  };
}

beforeEach(() => {
  dbMock.state.rows = [];
});

describe("request-meta", () => {
  it("AuditTrail: beschriftet Einträge aus dem MCP-Zugang", async () => {
    dbMock.state.rows = [auditEntry({ source: "mcp" })];
    render(await AuditTrail({ objectType: "urlaub", objectId: "antrag-1" }));
    expect(screen.getByRole("listitem")).toHaveTextContent("(MCP (KI-Assistent))");
  });

  it("AuditTrail: filtert nach Objekttyp und -Id und sortiert aufsteigend nach Zeit", async () => {
    await AuditTrail({ objectType: "urlaub", objectId: "antrag-1" });

    expect(dbMock.query.where).toHaveBeenCalledWith({
      and: [
        { eq: ["audit_log.object_type", "urlaub"] },
        { eq: ["audit_log.object_id", "antrag-1"] },
      ],
    });
    expect(dbMock.query.orderBy).toHaveBeenCalledWith({
      asc: "audit_log.created_at",
    });
  });

  it("AuditTrail: rendert nichts ohne Einträge", async () => {
    const element = await AuditTrail({ objectType: "urlaub", objectId: "x" });
    expect(element).toBeNull();
  });

  it("AuditTrail: zeigt Zeitpunkt, Aktion (ohne Unterstriche), Akteur und Quelle", async () => {
    dbMock.state.rows = [
      auditEntry({ action: "eingereicht", source: "web", createdAt: T1 }),
      auditEntry({
        action: "storno_beantragt",
        actorLabel: "KI-Assistent",
        source: "api",
        createdAt: T2,
      }),
      auditEntry({
        action: "automatisch_abgeschlossen",
        actorLabel: "System",
        source: "system",
      }),
    ];

    render(await AuditTrail({ objectType: "urlaub", objectId: "antrag-1" }));

    expect(screen.getByText("Verlauf (Audit-Log)")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(T1.toLocaleString("de-DE"));
    expect(items[0]).toHaveTextContent("eingereicht");
    expect(items[0]).toHaveTextContent("durch Anna Muster");
    expect(items[0]).toHaveTextContent("(Web-Oberfläche)");
    expect(items[1]).toHaveTextContent("storno beantragt");
    expect(items[1]).toHaveTextContent("durch KI-Assistent");
    expect(items[1]).toHaveTextContent("(API (KI))");
    expect(items[2]).toHaveTextContent("automatisch abgeschlossen");
    expect(items[2]).toHaveTextContent("(System)");
  });

  it("AuditTrail: zeigt unbekannte Quellen unverändert an", async () => {
    dbMock.state.rows = [auditEntry({ source: "import" })];

    render(await AuditTrail({ objectType: "urlaub", objectId: "antrag-1" }));

    expect(screen.getByRole("listitem")).toHaveTextContent("(import)");
  });

  it("HistoryCard: rendert nichts ohne frühere Versionen", async () => {
    const element = await HistoryCard({
      requestType: "urlaub",
      requestId: "antrag-1",
      renderSnapshot: () => null,
    });

    expect(getHistory).toHaveBeenCalledWith("urlaub", "antrag-1");
    expect(element).toBeNull();
  });

  it("HistoryCard: listet Versionen mit Zeitstempel und gerendertem Snapshot", async () => {
    vi.mocked(getHistory).mockResolvedValueOnce([
      {
        id: "h-1",
        requestType: "reisekosten",
        requestId: "rk-1",
        version: 1,
        snapshot: { destination: "Berlin" },
        createdAt: T1,
      },
      {
        id: "h-2",
        requestType: "reisekosten",
        requestId: "rk-1",
        version: 2,
        snapshot: { destination: "München" },
        createdAt: T2,
      },
    ]);
    const renderSnapshot = vi.fn(
      (snapshot: Record<string, unknown>, version: number) => (
        <p>
          Ziel v{version}: {String(snapshot.destination)}
        </p>
      )
    );

    render(
      await HistoryCard({
        requestType: "reisekosten",
        requestId: "rk-1",
        renderSnapshot,
      })
    );

    expect(screen.getByText("Frühere Versionen")).toBeInTheDocument();
    expect(screen.getByText(/^Version 1/)).toHaveTextContent(
      T1.toLocaleString("de-DE")
    );
    expect(screen.getByText(/^Version 2/)).toHaveTextContent(
      T2.toLocaleString("de-DE")
    );
    expect(screen.getByText("Ziel v1: Berlin")).toBeInTheDocument();
    expect(screen.getByText("Ziel v2: München")).toBeInTheDocument();
    expect(renderSnapshot).toHaveBeenCalledWith({ destination: "Berlin" }, 1);
    expect(renderSnapshot).toHaveBeenCalledWith({ destination: "München" }, 2);
  });
});
