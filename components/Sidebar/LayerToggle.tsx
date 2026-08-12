"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { NodeType } from "@/types/graph";

interface Props {
  visibleLayers: Set<NodeType>;
  onToggle: (type: NodeType) => void;
}

const LAYERS: {
  type: NodeType;
  label: string;
  color: string;
  /** 靜態 class 字串（Tailwind 需在原始碼可見才能產出樣式）。 */
  checkedClass: string;
}[] = [
  {
    type: "applicant",
    label: "申請人層",
    color: "#4E79A7",
    checkedClass:
      "data-[state=checked]:bg-layer-applicant data-[state=checked]:border-layer-applicant",
  },
  {
    type: "patent",
    label: "專利層",
    color: "#F28E2B",
    checkedClass:
      "data-[state=checked]:bg-layer-patent data-[state=checked]:border-layer-patent",
  },
  {
    type: "concept",
    label: "概念層",
    color: "#59A14F",
    checkedClass:
      "data-[state=checked]:bg-layer-concept data-[state=checked]:border-layer-concept",
  },
];

export default function LayerToggle({ visibleLayers, onToggle }: Props) {
  return (
    <div className="space-y-1.5">
      {LAYERS.map(({ type, label, color, checkedClass }) => (
        <div key={type} className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/60 transition-colors">
          <Checkbox
            id={`layer-${type}`}
            checked={visibleLayers.has(type)}
            onCheckedChange={() => onToggle(type)}
            className={`border-border ${checkedClass}`}
          />
          <Label
            htmlFor={`layer-${type}`}
            className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1.5"
          >
            <span
              aria-hidden
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ background: `var(--color-${type === "applicant" ? "layer-applicant" : type === "patent" ? "layer-patent" : "layer-concept"}, ${color})` }}
            />
            {label}
          </Label>
        </div>
      ))}
    </div>
  );
}
