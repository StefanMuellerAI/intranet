"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface OrgChartNode {
  id: string;
  name: string;
  isManagingDirector: boolean;
  technicalSupervisorId: string | null;
  disciplinarySupervisorId: string | null;
}

type EdgeKind = "technical" | "disciplinary" | "both";

interface LaidOutNode {
  id: string;
  name: string;
  isManagingDirector: boolean;
  x: number;
  y: number;
  isCurrent: boolean;
}

interface LaidOutEdge {
  key: string;
  kind: EdgeKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const NODE_W = 168;
const NODE_H = 56;
const H_GAP = 28;
const V_GAP = 72;

const COLOR_DISCIPLINARY = "#334155";
const COLOR_TECHNICAL = "#d97706";

function resolveSupervisor(
  id: string | null,
  activeIds: Set<string>
): string | null {
  return id && activeIds.has(id) ? id : null;
}

function buildLayout(
  nodes: OrgChartNode[],
  currentUserId: string
): {
  chartNodes: LaidOutNode[];
  edges: LaidOutEdge[];
  unassigned: OrgChartNode[];
  width: number;
  height: number;
} {
  const activeIds = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const resolved = new Map<
    string,
    { technical: string | null; disciplinary: string | null }
  >();
  for (const n of nodes) {
    resolved.set(n.id, {
      technical: resolveSupervisor(n.technicalSupervisorId, activeIds),
      disciplinary: resolveSupervisor(n.disciplinarySupervisorId, activeIds),
    });
  }

  const unassigned = nodes.filter((n) => {
    if (n.isManagingDirector) return false;
    const r = resolved.get(n.id)!;
    return !r.technical && !r.disciplinary;
  });
  const unassignedIds = new Set(unassigned.map((n) => n.id));
  const chartIds = nodes.filter((n) => !unassignedIds.has(n.id)).map((n) => n.id);
  const chartIdSet = new Set(chartIds);

  if (chartIds.length === 0) {
    return {
      chartNodes: [],
      edges: [],
      unassigned,
      width: 0,
      height: 0,
    };
  }

  // Reports indexed by supervisor (both edge kinds)
  const childrenOf = new Map<string, Set<string>>();
  for (const id of chartIds) {
    const r = resolved.get(id)!;
    for (const parent of [r.technical, r.disciplinary]) {
      if (parent && chartIdSet.has(parent)) {
        const set = childrenOf.get(parent) ?? new Set();
        set.add(id);
        childrenOf.set(parent, set);
      }
    }
  }

  const roots = chartIds.filter((id) => {
    const r = resolved.get(id)!;
    const techInChart = r.technical && chartIdSet.has(r.technical);
    const discInChart = r.disciplinary && chartIdSet.has(r.disciplinary);
    return !techInChart && !discInChart;
  });

  // BFS depth from roots (cycle-safe)
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const root of roots) {
    depth.set(root, 0);
    queue.push(root);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depth.get(id)!;
    for (const child of childrenOf.get(id) ?? []) {
      if (depth.has(child)) continue;
      depth.set(child, d + 1);
      queue.push(child);
    }
  }

  // Orphans in cycles / unreachable: place at depth 0
  for (const id of chartIds) {
    if (!depth.has(id)) depth.set(id, 0);
  }

  const maxDepth = Math.max(...depth.values(), 0);
  const levels: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const id of chartIds) {
    levels[depth.get(id)!].push(id);
  }

  // Stable order by name within level
  for (const level of levels) {
    level.sort((a, b) =>
      (byId.get(a)?.name ?? "").localeCompare(byId.get(b)?.name ?? "", "de")
    );
  }

  const levelWidths = levels.map(
    (ids) =>
      ids.length * NODE_W + Math.max(0, ids.length - 1) * H_GAP
  );
  const width = Math.max(...levelWidths, NODE_W);
  const height = levels.length * NODE_H + Math.max(0, levels.length - 1) * V_GAP;

  const positions = new Map<string, { x: number; y: number }>();
  levels.forEach((ids, level) => {
    const levelWidth = levelWidths[level];
    const startX = (width - levelWidth) / 2;
    ids.forEach((id, i) => {
      positions.set(id, {
        x: startX + i * (NODE_W + H_GAP),
        y: level * (NODE_H + V_GAP),
      });
    });
  });

  const chartNodes: LaidOutNode[] = chartIds.map((id) => {
    const n = byId.get(id)!;
    const pos = positions.get(id)!;
    return {
      id,
      name: n.name,
      isManagingDirector: n.isManagingDirector,
      x: pos.x,
      y: pos.y,
      isCurrent: id === currentUserId,
    };
  });

  const edges: LaidOutEdge[] = [];
  for (const id of chartIds) {
    const r = resolved.get(id)!;
    const childPos = positions.get(id)!;
    const x1 = childPos.x + NODE_W / 2;
    const y1 = childPos.y;

    const parents = new Map<string, EdgeKind>();
    if (r.disciplinary && chartIdSet.has(r.disciplinary)) {
      parents.set(r.disciplinary, "disciplinary");
    }
    if (r.technical && chartIdSet.has(r.technical)) {
      const existing = parents.get(r.technical);
      parents.set(
        r.technical,
        existing === "disciplinary" ? "both" : "technical"
      );
    }

    for (const [parentId, kind] of parents) {
      const parentPos = positions.get(parentId);
      if (!parentPos) continue;
      edges.push({
        key: `${id}-${parentId}-${kind}`,
        kind,
        x1,
        y1,
        x2: parentPos.x + NODE_W / 2,
        y2: parentPos.y + NODE_H,
      });
    }
  }

  return { chartNodes, edges, unassigned, width, height };
}

function edgePath(e: LaidOutEdge, offset = 0): string {
  const midY = (e.y1 + e.y2) / 2;
  const x1 = e.x1 + offset;
  const x2 = e.x2 + offset;
  return `M ${x1} ${e.y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${e.y2}`;
}

function EdgePaths({ edge }: { edge: LaidOutEdge }) {
  if (edge.kind === "both") {
    return (
      <>
        <path
          d={edgePath(edge, -3)}
          fill="none"
          stroke={COLOR_DISCIPLINARY}
          strokeWidth={2}
        />
        <path
          d={edgePath(edge, 3)}
          fill="none"
          stroke={COLOR_TECHNICAL}
          strokeWidth={2}
          strokeDasharray="6 4"
        />
      </>
    );
  }
  if (edge.kind === "disciplinary") {
    return (
      <path
        d={edgePath(edge)}
        fill="none"
        stroke={COLOR_DISCIPLINARY}
        strokeWidth={2}
      />
    );
  }
  return (
    <path
      d={edgePath(edge)}
      fill="none"
      stroke={COLOR_TECHNICAL}
      strokeWidth={2}
      strokeDasharray="6 4"
    />
  );
}

export function OrgChart({
  nodes,
  currentUserId,
}: {
  nodes: OrgChartNode[];
  currentUserId: string;
}) {
  const { chartNodes, edges, unassigned, width, height } = useMemo(
    () => buildLayout(nodes, currentUserId),
    [nodes, currentUserId]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block h-0.5 w-6"
            style={{ backgroundColor: COLOR_DISCIPLINARY }}
            aria-hidden
          />
          Disziplinarisch
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block h-0.5 w-6 border-t-2 border-dashed"
            style={{ borderColor: COLOR_TECHNICAL }}
            aria-hidden
          />
          Fachlich
        </span>
        <span className="text-xs">
          Doppelstrich = fachlich und disziplinarisch dieselbe Person
        </span>
      </div>

      {chartNodes.length === 0 && unassigned.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Noch keine Mitarbeitenden vorhanden.
        </p>
      ) : null}

      {chartNodes.length > 0 ? (
        <div className="overflow-x-auto rounded-md border bg-muted/30 p-6">
          <div
            className="relative"
            style={{
              width: Math.max(width, 280),
              height: Math.max(height, NODE_H),
            }}
          >
            <svg
              className="pointer-events-none absolute inset-0"
              width={width}
              height={height}
              aria-hidden
            >
              {edges.map((edge) => (
                <EdgePaths key={edge.key} edge={edge} />
              ))}
            </svg>
            {chartNodes.map((node) => (
              <div
                key={node.id}
                className={cn(
                  "absolute flex flex-col items-center justify-center gap-1 rounded-md border bg-background px-3 text-center shadow-sm",
                  node.isCurrent && "ring-2 ring-primary ring-offset-2"
                )}
                style={{
                  left: node.x,
                  top: node.y,
                  width: NODE_W,
                  height: NODE_H,
                }}
              >
                <span className="w-full truncate text-sm font-medium leading-tight">
                  {node.name}
                </span>
                {node.isManagingDirector ? (
                  <Badge variant="secondary" className="h-4 text-[10px]">
                    Geschäftsführung
                  </Badge>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {unassigned.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Ohne Zuordnung
          </h2>
          <ul className="flex flex-wrap gap-2">
            {unassigned
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name, "de"))
              .map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "rounded-md border bg-background px-3 py-2 text-sm",
                    n.id === currentUserId &&
                      "ring-2 ring-primary ring-offset-2"
                  )}
                >
                  {n.name}
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
