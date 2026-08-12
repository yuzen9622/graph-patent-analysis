"use client";

import { EyeOff } from "lucide-react";
import type { Community } from "@/types/graph";

interface Props {
  communities: Community[];
  hiddenCommunities: Set<number>;
  onToggle: (id: number) => void;
}

export default function CommunityLegend({
  communities,
  hiddenCommunities,
  onToggle,
}: Props) {
  if (communities.length === 0) return null;

  const hiddenCount = communities.filter((c) =>
    hiddenCommunities.has(c.id),
  ).length;

  return (
    <div>
      <p className="mb-2 text-[0.7rem] leading-relaxed text-muted-foreground">
        社群名稱取群內連結度最高的概念作為代表概念，不等同人工分類名稱。
      </p>
      {hiddenCount > 0 && (
        <div className="mb-2 flex items-center justify-between rounded-md border border-border bg-muted/40 px-2 py-1.5">
          <span className="inline-flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
            <EyeOff size={11} aria-hidden />
            已隱藏 {hiddenCount} 個社群
          </span>
          <button
            type="button"
            onClick={() =>
              communities
                .filter((c) => hiddenCommunities.has(c.id))
                .forEach((c) => onToggle(c.id))
            }
            className="text-[0.7rem] text-primary hover:underline cursor-pointer"
          >
            全部顯示
          </button>
        </div>
      )}
      <ul className="space-y-0.5">
        {communities.map((c) => {
          const isHidden = hiddenCommunities.has(c.id);
          return (
            <li key={c.id}>
              <button
                onClick={() => onToggle(c.id)}
                title={isHidden ? `顯示「${c.name}」` : `隱藏「${c.name}」`}
                aria-pressed={!isHidden}
                className="w-full flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-muted transition-colors cursor-pointer group"
              >
                <span
                  aria-hidden
                  className="w-3 h-3 rounded-full shrink-0 transition-opacity"
                  style={{ background: c.color, opacity: isHidden ? 0.3 : 1 }}
                />
                <span
                  className={`flex-1 text-xs text-left truncate transition-colors ${
                    isHidden
                      ? "text-muted-foreground/60 line-through decoration-muted-foreground/40"
                      : "text-foreground"
                  }`}
                >
                  {c.name}
                </span>
                <span className="text-[0.7rem] text-muted-foreground shrink-0 tabular-nums">
                  {c.node_count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
