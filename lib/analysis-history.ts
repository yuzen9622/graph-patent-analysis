export interface HistoryEntry {
  id: string
  filename: string
  timestamp: string
  status: 'analyzing' | 'completed' | 'error'
  patentCount?: number
}

const STORAGE_KEY = 'patent-analysis-history'
export const HISTORY_EVENT = 'patent-history-changed'

export function loadHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as HistoryEntry[]
  } catch {
    return []
  }
}

function persistHistory(entries: HistoryEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, 50)))
  window.dispatchEvent(new CustomEvent(HISTORY_EVENT))
}

export function addHistoryEntry(entry: HistoryEntry) {
  const entries = loadHistory()
  const idx = entries.findIndex(e => e.id === entry.id)
  if (idx >= 0) entries[idx] = entry
  else entries.unshift(entry)
  persistHistory(entries)
}

export function updateHistoryStatus(id: string, status: HistoryEntry['status']) {
  const entries = loadHistory()
  const entry = entries.find(e => e.id === id)
  if (entry) {
    entry.status = status
    persistHistory(entries)
  }
}
