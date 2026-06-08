"use client";

import type { GraphData } from "@/types/graph";

interface Props {
  stats: GraphData["stats"];
}

export default function StatsBar({ stats }: Props) {
  const items = [
    { value: stats.applicant_count, label: "申請人" },
    { value: stats.patent_count, label: "專利" },
    { value: stats.concept_count, label: "技術概念" },
    { value: stats.community_count, label: "社群" },
  ];

  const [y0, y1] = stats.year_range;
  const yearLabel = y0 && y1 ? `${y0} – ${y1}` : "—";

  return (
    <footer className="shrink-0 bg-accent border-t border-border px-4 py-2 flex items-center gap-4 overflow-x-auto">
      <div className="flex items-center gap-1 shrink-0">
        {items.map((item, i) => (
          <span key={item.label} className="flex items-center gap-1 text-xs">
            {i > 0 && <span className="text-border mx-1">·</span>}
            <span className="font-semibold text-primary">
              {item.value.toLocaleString()}
            </span>
            <span className="text-muted-foreground">{item.label}</span>
          </span>
        ))}
        <span className="text-border mx-1">·</span>
        <span className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">年份</span>
          <span className="font-semibold text-primary">{yearLabel}</span>
        </span>
      </div>
    </footer>
  );
}
