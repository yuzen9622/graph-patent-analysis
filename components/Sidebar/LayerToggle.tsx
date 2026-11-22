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
  swatch: string;
}[] = [
  {
    type: "applicant",
    label: "申請人層",
    swatch: "bg-layer-applicant",
  },
  {
    type: "patent",
    label: "專利層",
    swatch: "bg-layer-patent",
  },
  {
    type: "concept",
    label: "概念層",
    swatch: "bg-layer-concept",
  },
];

export default function LayerToggle({ visibleLayers, onToggle }: Props) {
  return (
    <div className="space-y-1.5">
      {LAYERS.map(({ type, label, swatch }) => (
        <div key={type} className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/60 transition-colors">
          <Checkbox
            id={`layer-${type}`}
            checked={visibleLayers.has(type)}
            onCheckedChange={() => onToggle(type)}
          />
          <Label
            htmlFor={`layer-${type}`}
            className="flex items-center gap-1.5"
          >
            <span
              aria-hidden
              className={`w-2 h-2 rounded-sm shrink-0 ${swatch}`}
            />
            {label}
          </Label>
        </div>
      ))}
    </div>
  );
}
