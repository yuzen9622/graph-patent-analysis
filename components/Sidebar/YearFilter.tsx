'use client'

import { useState, useCallback, useEffect } from 'react'
import { Slider } from '@/components/ui/slider'

interface Props {
  value: [number, number]
  fullRange: [number, number]
  onChange: (range: [number, number]) => void
}

function toArr(v: number | readonly number[]): number[] {
  return Array.isArray(v) ? [...v] : [v as number]
}

export default function YearFilter({ value, fullRange, onChange }: Props) {
  const [local, setLocal] = useState<[number, number]>(value)

  useEffect(() => { setLocal(value) }, [value])

  const handleChange = useCallback((vals: number | readonly number[]) => {
    const arr = toArr(vals)
    if (arr.length >= 2) {
      const range: [number, number] = [arr[0], arr[1]]
      setLocal(range)
      onChange(range)
    }
  }, [onChange])

  const [min, max] = fullRange
  const hasRange = min > 0 && max > 0 && max >= min

  if (!hasRange) {
    return <p className="text-xs text-[#475569]">資料中無年份資訊</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between text-xs">
        <span className="font-semibold text-[#4E79A7]">{local[0]}</span>
        <span className="text-[#475569]">–</span>
        <span className="font-semibold text-[#4E79A7]">{local[1]}</span>
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
      <div className="flex justify-between text-[0.65rem] text-[#475569]">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}
