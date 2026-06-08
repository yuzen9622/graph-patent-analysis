"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { NodeType } from "@/types/graph";

interface Props {
  visibleLayers: Set<NodeType>;
  onToggle: (type: NodeType) => void;
}

const LAYERS: { type: NodeType; label: string; color: string; token: string }[] = [
  { type: "applicant", label: "申請人層", color: "#4E79A7", token: "layer-applicant" },
  { type: "patent", label: "專利層", color: "#F28E2B", token: "layer-patent" },
  { type: "concept", label: "概念層", color: "#59A14F", token: "layer-concept" },
];

export default function LayerToggle({ visibleLayers, onToggle }: Props) {
  return (
    <div className="space-y-2">
      {LAYERS.map(({ type, label, color, token }) => (
        <div key={type} className="flex items-center gap-2">
          <Checkbox
            id={`layer-${type}`}
            checked={visibleLayers.has(type)}
            onCheckedChange={() => onToggle(type)}
            className={`border-border data-[state=checked]:bg-${token} data-[state=checked]:border-${token}`}
          />
          <Label
            htmlFor={`layer-${type}`}
            className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1.5"
          >
            <span
              aria-hidden
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ background: `var(--color-${token}, ${color})` }}
            />
            {label}
          </Label>
        </div>
      ))}
    </div>
  );
}
