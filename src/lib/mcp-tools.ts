import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";
import { resolveUserFromMcpAuth } from "@/lib/mcp-auth";
import {
  createCommissionClaim,
  commissionInputSchema,
  resubmitCommissionClaimForUser,
  withdrawCommissionClaimForUser,
} from "@/lib/requests/commission";
import {
  createExpenseReport,
  expenseReportInputSchema,
  resubmitExpenseReportForUser,
  withdrawExpenseReportForUser,
} from "@/lib/requests/expense";
import { getMyProfile, getMyRequest, listMyRequests } from "@/lib/requests/query";
import {
  closeSickLeaveForUser,
  createSickLeave,
  sickLeaveInputSchema,
} from "@/lib/requests/sick-leave";
import type { RequestType } from "@/lib/requests/types";
import {
  createVacationRequest,
  resubmitVacationRequestForUser,
  vacationInputSchema,
  withdrawVacationRequestForUser,
} from "@/lib/requests/vacation";
import {
  createWorkationRequest,
  resubmitWorkationRequestForUser,
  withdrawWorkationRequestForUser,
  workationInputSchema,
} from "@/lib/requests/workation";

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unbekannter Fehler.";
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

async function withUser(
  authInfo: AuthInfo | undefined,
  fn: (user: Awaited<ReturnType<typeof resolveUserFromMcpAuth>>) => Promise<unknown>
) {
  try {
    const user = await resolveUserFromMcpAuth(authInfo);
    return textResult(await fn(user));
  } catch (error) {
    return errorResult(error);
  }
}

const requestTypeSchema = z.enum([
  "vacation",
  "workation",
  "expense",
  "commission",
  "sick_leave",
]);

/**
 * Registriert alle per-User-Antrags-Tools. Ownership kommt ausschließlich
 * aus dem OAuth-Kontext — nie aus Tool-Parametern.
 */
export function registerIntranetMcpTools(server: McpServer) {
  server.registerTool(
    "get_my_profile",
    {
      description:
        "Profil und Kontingente des verbundenen Mitarbeitenden (Resturlaub, Workation-Kontingent).",
    },
    async (extra) => withUser(extra.authInfo, getMyProfile)
  );

  server.registerTool(
    "list_my_requests",
    {
      description:
        "Listet nur die eigenen Anträge. Optional nach Typ und Status filtern.",
      inputSchema: {
        type: requestTypeSchema.optional(),
        status: z
          .string()
          .optional()
          .describe(
            "z. B. eingereicht, genehmigt, beanstandet, zurueckgezogen, gemeldet, abgeschlossen"
          ),
      },
    },
    async (args, extra) =>
      withUser(extra.authInfo, (user) =>
        listMyRequests(user, {
          type: args.type as RequestType | undefined,
          status: args.status,
        })
      )
  );

  server.registerTool(
    "get_my_request",
    {
      description:
        "Detail eines eigenen Antrags inkl. Historie (falls vorhanden).",
      inputSchema: {
        type: requestTypeSchema,
        id: z.string().uuid(),
      },
    },
    async (args, extra) =>
      withUser(extra.authInfo, (user) =>
        getMyRequest(user, args.type as RequestType, args.id)
      )
  );

  server.registerTool(
    "create_vacation_request",
    {
      description: "Neuen Urlaubsantrag für den verbundenen User einreichen.",
      inputSchema: vacationInputSchema.shape,
    },
    async (args, extra) =>
      withUser(extra.authInfo, (user) =>
        createVacationRequest(user, vacationInputSchema.parse(args), "mcp")
      )
  );

  server.registerTool(
    "create_workation_request",
    {
      description:
        "Neuen Workation-Antrag einreichen. Alle sieben Erklärungen (decl*) müssen true sein.",
      inputSchema: workationInputSchema,
    },
    async (args, extra) =>
      withUser(extra.authInfo, (user) =>
        createWorkationRequest(user, workationInputSchema.parse(args), "mcp")
      )
  );

  server.registerTool(
    "create_expense_report",
    {
      description:
        "Neue Reisekostenabrechnung einreichen (ohne Beleg-Upload; Belege ggf. später im Web ergänzen).",
      inputSchema: expenseReportInputSchema,
    },
    async (args, extra) =>
      withUser(extra.authInfo, (user) =>
        createExpenseReport(user, expenseReportInputSchema.parse(args), "mcp", null)
      )
  );

  server.registerTool(
    "create_commission_claim",
    {
      description: "Neuen Provisionsanspruch einreichen.",
      inputSchema: commissionInputSchema,
    },
    async (args, extra) =>
      withUser(extra.authInfo, (user) =>
        createCommissionClaim(user, commissionInputSchema.parse(args), "mcp")
      )
  );

  server.registerTool(
    "create_sick_leave",
    {
      description:
        "Krankmeldung erfassen (nur Zeitraum/Typ, keine Diagnose). Nachweis über eAU.",
      inputSchema: sickLeaveInputSchema.shape,
    },
    async (args, extra) =>
      withUser(extra.authInfo, (user) =>
        createSickLeave(user, sickLeaveInputSchema.parse(args), "mcp")
      )
  );

  server.registerTool(
    "withdraw_my_request",
    {
      description:
        "Eigenen eingereichten oder beanstandeten Antrag zurückziehen (nicht für Krankmeldung).",
      inputSchema: {
        type: z.enum(["vacation", "workation", "expense", "commission"]),
        id: z.string().uuid(),
      },
    },
    async (args, extra) =>
      withUser(extra.authInfo, async (user) => {
        switch (args.type) {
          case "vacation":
            return withdrawVacationRequestForUser(user, args.id, "mcp");
          case "workation":
            return withdrawWorkationRequestForUser(user, args.id, "mcp");
          case "expense":
            return withdrawExpenseReportForUser(user, args.id, "mcp");
          case "commission":
            return withdrawCommissionClaimForUser(user, args.id, "mcp");
        }
      })
  );

  server.registerTool(
    "resubmit_my_request",
    {
      description:
        "Beanstandeten oder zurückgezogenen eigenen Antrag korrigieren und erneut einreichen. payload = Felder wie beim jeweiligen create_*-Tool.",
      inputSchema: {
        type: z.enum(["vacation", "workation", "expense", "commission"]),
        id: z.string().uuid(),
        payload: z.record(z.string(), z.unknown()),
      },
    },
    async (args, extra) =>
      withUser(extra.authInfo, async (user) => {
        switch (args.type) {
          case "vacation":
            return resubmitVacationRequestForUser(
              user,
              args.id,
              vacationInputSchema.parse(args.payload),
              "mcp"
            );
          case "workation":
            return resubmitWorkationRequestForUser(
              user,
              args.id,
              workationInputSchema.parse(args.payload),
              "mcp"
            );
          case "expense":
            return resubmitExpenseReportForUser(
              user,
              args.id,
              expenseReportInputSchema.parse(args.payload),
              "mcp",
              null
            );
          case "commission":
            return resubmitCommissionClaimForUser(
              user,
              args.id,
              commissionInputSchema.parse(args.payload),
              "mcp"
            );
        }
      })
  );

  server.registerTool(
    "close_my_sick_leave",
    {
      description: "Eigene offene Krankmeldung mit tatsächlichem Enddatum abschließen.",
      inputSchema: {
        id: z.string().uuid(),
        endDate: z.string().min(1),
      },
    },
    async (args, extra) =>
      withUser(extra.authInfo, (user) =>
        closeSickLeaveForUser(user, args.id, args.endDate, "mcp")
      )
  );
}
