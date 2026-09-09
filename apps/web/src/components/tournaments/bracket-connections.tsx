"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DrawEdge } from "@/lib/tournament-draw";

/** Measure real card ports, including variable-height labels and translated text. */
export function BracketConnections({ edges, children }: { edges: DrawEdge[]; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<Array<{ key: string; d: string; outcome: string }>>([]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const rtl = getComputedStyle(element).direction === "rtl";
      const direction = rtl ? -1 : 1;
      const cards = new Map(Array.from(element.querySelectorAll<HTMLElement>("[data-bracket-slot]")).map(card => [card.dataset.bracketSlot, card]));
      const next = edges.flatMap((edge, index) => {
        const source = cards.get(edge.from);
        const target = cards.get(edge.to);
        const port = target?.querySelector(`[data-bracket-side="${edge.side}"]`);
        if (!source || !target || !port) return [];
        const a = source.getBoundingClientRect();
        const b = target.getBoundingClientRect();
        const side = port.getBoundingClientRect();
        const x1 = (rtl ? a.left : a.right) - bounds.left;
        const x2 = (rtl ? b.right : b.left) - bounds.left;
        const y1 = (a.top + a.bottom) / 2 - bounds.top;
        const y2 = (side.top + side.bottom) / 2 - bounds.top;
        const gap = (x2 - x1) * direction;
        // Adjacent rounds use a clean elbow; cross-band and skipped rounds travel
        // through a reserved outside lane so a line never cuts through a match.
        const sourceBand = source.closest("[data-bracket-branch]");
        const targetBand = target.closest("[data-bracket-branch]");
        const sameBand = sourceBand === targetBand;
        let lane = 8 + index % 5 * 5;
        if (!sameBand && sourceBand && targetBand) {
          const first = sourceBand.getBoundingClientRect();
          const second = targetBand.getBoundingClientRect();
          lane = (first.top < second.top ? first.bottom + second.top : second.bottom + first.top) / 2 - bounds.top + (index % 3 - 1) * 5;
        }
        const d = sameBand && gap > 0 && gap < 100
          ? `M ${x1} ${y1} H ${(x1 + x2) / 2} V ${y2} H ${x2}`
          : `M ${x1} ${y1} H ${x1 + direction * 12} V ${lane} H ${x2 - direction * 12} V ${y2} H ${x2}`;
        return [{ key: `${edge.from}-${edge.to}-${edge.side}`, d, outcome: edge.outcome }];
      });
      setPaths(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    element.querySelectorAll("[data-bracket-slot]").forEach(card => observer.observe(card));
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [edges]);
  return <div ref={root} className="relative flex flex-col gap-8 pt-10" data-bracket-graph="true" data-bracket-edge-count={edges.length}>
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible text-muted-foreground/60" fill="none">
      {paths.map(path => <path key={path.key} data-bracket-edge={path.outcome} d={path.d} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeDasharray={path.outcome === "loser" ? "4 4" : undefined} />)}
    </svg>
    {children}
  </div>;
}
