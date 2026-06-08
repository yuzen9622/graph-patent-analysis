'use client'

import type { Community } from '@/types/graph'

interface Props {
  communities: Community[]
  hiddenCommunities: Set<number>
  onToggle: (id: number) => void
}

export default function CommunityLegend({ communities, hiddenCommunities, onToggle }: Props) {
  if (communities.length === 0) return null

  const allHidden = communities.every(c => hiddenCommunities.has(c.id))

  return (
    <div>
      {allHidden && (
        <p className="text-xs text-[#475569] mb-2">
          所有社群已隱藏，點擊色點以顯示
        </p>
      )}
      <ul className="space-y-1">
        {communities.map(c => {
          const isHidden = hiddenCommunities.has(c.id)
          return (
            <li key={c.id}>
              <button
                onClick={() => onToggle(c.id)}
                title={isHidden ? `顯示「${c.name}」` : `隱藏「${c.name}」`}
                className="w-full flex items-center gap-2 px-1 py-1 rounded hover:bg-[#0F172A] transition-colors cursor-pointer group"
              >
                <span
                  aria-hidden
                  className="w-3 h-3 rounded-full flex-shrink-0 transition-opacity"
                  style={{ background: c.color, opacity: isHidden ? 0.3 : 1 }}
                />
                <span
                  className="flex-1 text-xs text-left truncate transition-colors"
                  style={{ color: isHidden ? '#475569' : '#CBD5E1' }}
                >
                  {c.name}
                </span>
                <span className="text-[0.65rem] text-[#475569] flex-shrink-0 tabular-nums">
                  {c.node_count}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
