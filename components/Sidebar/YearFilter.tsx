"use client";

import { useState, useCallback } from "react";
import { Slider } from "@/components/ui/slider";

interface Props {
  value: [number, number];
  fullRange: [number, number];
  onChange: (range: [number, number]) => void;
}

function toArr(v: number | readonly number[]): number[] {
  return Array.isArray(v) ? [...v] : [v as number];
}

/** 把輸入夾進 [min, max] 並整數化；非數值回 min。 */
function clampYear(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, Math.round(v)));
}

export default function YearFilter({ value, fullRange, onChange }: Props) {
  const [local, setLocal] = useState<[number, number]>(value);
  const [prevValue, setPrevValue] = useState<[number, number]>(value);
  const [editing, setEditing] = useState<"min" | "max" | null>(null);
  const [draft, setDraft] = useState("");

  if (value[0] !== prevValue[0] || value[1] !== prevValue[1]) {
    setLocal(value);
    setPrevValue(value);
  }

  const handleChange = useCallback(
    (vals: number | readonly number[]) => {
      const arr = toArr(vals);
      if (arr.length >= 2) {
        const range: [number, number] = [arr[0], arr[1]];
        setLocal(range);
        onChange(range);
      }
    },
    [onChange],
  );

  const [min, max] = fullRange;
  const hasRange = min > 0 && max > 0 && max >= min;

  const startEdit = (which: "min" | "max") => {
    setEditing(which);
    setDraft(String(local[which === "min" ? 0 : 1]));
  };

  /** 提交輸入：夾到 [min, max] 且保持 min ≤ max；非法輸入還原。 */
  const commitEdit = () => {
    if (editing === null) return;
    const parsed = Number(draft);
    let next: [number, number] = local;
    if (Number.isFinite(parsed)) {
      const clamped = clampYear(parsed, min, max);
      next =
        editing === "min"
          ? [Math.min(clamped, local[1]), local[1]]
          : [local[0], Math.max(clamped, local[0])];
    }
    setEditing(null);
    setLocal(next);
    onChange(next);
  };

  if (!hasRange) {
    return <p className="text-xs text-muted-foreground">資料中無年份資訊</p>;
  }

  const yearButtonCls =
    "rounded px-1 py-0.5 font-semibold text-foreground tabular-nums hover:bg-accent hover:text-primary cursor-pointer";
  const yearInputCls =
    "w-16 rounded border border-border bg-background px-1 py-0.5 text-center font-semibold text-foreground tabular-nums outline-none focus:border-primary";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        {editing === "min" ? (
          <input
            autoFocus
            type="number"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitEdit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitEdit();
              if (event.key === "Escape") setEditing(null);
            }}
            className={yearInputCls}
            aria-label="起始年份（點擊可輸入）"
          />
        ) : (
          <button
            type="button"
            onClick={() => startEdit("min")}
            className={yearButtonCls}
            title="點擊以輸入年份"
          >
            {local[0]}
          </button>
        )}
        <span className="text-muted-foreground">–</span>
        {editing === "max" ? (
          <input
            autoFocus
            type="number"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitEdit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitEdit();
              if (event.key === "Escape") setEditing(null);
            }}
            className={yearInputCls}
            aria-label="結束年份（點擊可輸入）"
          />
        ) : (
          <button
            type="button"
            onClick={() => startEdit("max")}
            className={yearButtonCls}
            title="點擊以輸入年份"
          >
            {local[1]}
          </button>
        )}
      </div>
      <Slider
        min={min}
        max={max}
        step={1}
        value={local}
        onValueChange={handleChange}
        className="w-full"
        aria-label="年份範圍篩選"
      />
      <div className="flex justify-between text-[0.65rem] text-muted-foreground">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
