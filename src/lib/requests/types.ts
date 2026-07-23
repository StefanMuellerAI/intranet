export type RequestActorSource = "web" | "mcp";

export type RequestType =
  | "vacation"
  | "workation"
  | "expense"
  | "commission"
  | "sick_leave";

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  vacation: "Urlaub",
  workation: "Workation",
  expense: "Reisekosten",
  commission: "Provision",
  sick_leave: "Krankmeldung",
};
