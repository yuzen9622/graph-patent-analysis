/**
 * PRD v2 / P5 — IPC classification analysis (view layer only).
 *
 * Reader's guide (spec docs/PRD-v2-P5-IPC分析.md, S1–S8):
 *   * S1 projection: a normalised IPC key (`G06Q10/10`, or depth-3 `G06Q`)
 *     projects to L1=`G` / L2=`G06` / L3=`G06Q` / L4=`G06Q10` / L5=`G06Q10/10`.
 *     Depth-3 keys have NO L4/L5 (P0 §3.2: they do not join L4/L5 grouping).
 *   * S2 filter: a patent is kept iff ANY of its projected keys at the chosen
 *     level is selected (OR). Combined with P2 sourceFiles as AND.
 *   * S4 colouring: concept nodes take the dominant IPC of their covering
 *     patents (majority vote; tie → lexicographically smaller key). No IPC
 *     patent → neutral (node keeps its current colour).
 *   * S5 palette: IPC_COLORS cycled by the sorted rank of the key.
 *
 * All functions are pure (no DB, no side effects) and unit-testable — same
 * convention as lib/concept-metrics.ts.
 */

import type { GraphData, GraphNode } from '../types/graph'

export type IpcLevel = 1 | 2 | 3 | 4 | 5

export const DEFAULT_IPC_LEVEL: IpcLevel = 3

/**
 * PRD v2 / P5 (S5): IPC 專用色盤。避開來源檔色盤（sky/emerald/amber/violet/…）
 * 與社群色盤，以免「依 IPC」與「依來源」在同色語意下混淆。key → 色 =
 * 該層級排序後索引 mod 本長度（圖例與節點同規則，跨圖穩定）。
 */
export const IPC_COLORS = [
  '#1d4ed8', // blue-700
  '#0e7490', // cyan-700
  '#15803d', // green-700
  '#a16207', // yellow-700
  '#b45309', // amber-700
  '#be185d', // pink-700
  '#7c3aed', // violet-700
  '#475569', // slate-600
  '#0f766e', // teal-700
  '#dc2626', // red-600
  '#4d7c0f', // lime-700
  '#9333ea', // purple-600
]

/** `^([A-H]\d{2}[A-Z])(\d{0,4})(?:/(\d{1,6}))?$` — normalised key shape. */
const IPC_KEY_RE = /^([A-H]\d{2}[A-Z])(\d{0,4})(?:\/(\d{1,6}))?$/

/**
 * S1: project a normalised IPC key onto a level. Returns `null` when the key
 * cannot project there (depth-3 key at L4/L5, or a malformed key).
 */
export function ipcKeyAtLevel(key: string, level: IpcLevel): string | null {
  if (level < 1 || level > 5) return null
  const m = IPC_KEY_RE.exec(key)
  if (!m) return null
  const subclass = m[1]
  const main = m[2]
  const group = m[3]
  if (level === 1) return subclass[0]
  if (level === 2) return subclass.slice(0, 3)
  if (level === 3) return subclass
  // L4 / L5 need a main group; depth-3 keys (`G06Q`, main = '') cannot.
  if (!main) return null
  if (level === 4) return `${subclass}${main}`
  return group ? `${subclass}${main}/${group}` : null
}

/**
 * S1: a patent's distinct keys at the given level. Missing / unparseable
 * ipc5 lists project to an empty set (such patents never match an IPC filter).
 */
export function ipcKeysOfPatents(
  ipc5: string[] | undefined,
  level: IpcLevel,
): Set<string> {
  const out = new Set<string>()
  for (const key of ipc5 ?? []) {
    const projected = ipcKeyAtLevel(key, level)
    if (projected !== null) out.add(projected)
  }
  return out
}

/** All distinct IPC keys at a level, sorted (colour-rank basis, S5). */
export function ipcSortedKeys(graph: GraphData, level: IpcLevel): string[] {
  const set = new Set<string>()
  for (const node of graph.nodes) {
    if (node.type !== 'patent') continue
    for (const key of ipcKeysOfPatents(node.ipc5, level)) set.add(key)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-Hant'))
}

/** S5: deterministic palette colour for an IPC key (by sorted rank). */
export function ipcColorOf(key: string, sortedKeys: string[]): string {
  const index = sortedKeys.indexOf(key)
  if (index < 0) return '#94a3b8'
  return IPC_COLORS[index % IPC_COLORS.length]
}

/** S2: raw patent ids whose projected key set intersects the selection. */
export function ipcSelectedRawIds(
  graph: GraphData,
  level: IpcLevel,
  selectedKeys: string[],
): Set<string> {
  const want = new Set(selectedKeys)
  const out = new Set<string>()
  for (const node of graph.nodes) {
    if (node.type !== 'patent') continue
    const keys = ipcKeysOfPatents(node.ipc5, level)
    let hit = false
    for (const key of keys) {
      if (want.has(key)) {
        hit = true
        break
      }
    }
    if (hit) out.add(node.id.replace(/^patent:/, ''))
  }
  return out
}

export interface IpcTreeNode {
  /** IPC key at this node's level (e.g. `G`, `G06`, `G06Q`, …). */
  key: string
  level: number
  /** distinct patents whose projected keys include this key. */
  count: number
  children: IpcTreeNode[]
}

/**
 * S8: hierarchical IPC tree down to `level` (root = L1). Counts are distinct
 * patent counts per key at that key's own level; a parent's count equals the
 * union of its descendants because every patent that projects onto a parent
 * also projects onto ≥1 child (depth-3 keys excluded at L4/L5 by S1).
 */
export function ipcTreeOf(graph: GraphData, level: IpcLevel): IpcTreeNode[] {
  // key → patents per level, built from the patents' projections.
  const byLevel: Array<Map<string, Set<string>>> = [new Map(), new Map(), new Map(), new Map(), new Map()]
  for (const node of graph.nodes) {
    if (node.type !== 'patent') continue
    const raw = node.id.replace(/^patent:/, '')
    for (let lvl = 1 as IpcLevel; lvl <= level; lvl += 1) {
      for (const key of ipcKeysOfPatents(node.ipc5, lvl as IpcLevel)) {
        const m = byLevel[lvl - 1]
        const s = m.get(key) ?? new Set<string>()
        s.add(raw)
        m.set(key, s)
      }
    }
  }

  function childrenOf(key: string, lvl: number): IpcTreeNode[] {
    if (lvl >= level) return []
    const childMap = byLevel[lvl]
    const next = new Map<string, Set<string>>()
    for (const k of childMap.keys()) {
      if (k.startsWith(key)) next.set(k, childMap.get(k) ?? new Set())
    }
    return Array.from(next.keys())
      .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
      .map((k) => ({
        key: k,
        level: lvl + 1,
        count: next.get(k)?.size ?? 0,
        children: childrenOf(k, lvl + 1),
      }))
  }

  const rootMap = byLevel[0]
  return Array.from(rootMap.keys())
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    .map((key) => ({
      key,
      level: 1,
      count: rootMap.get(key)?.size ?? 0,
      children: childrenOf(key, 1),
    }))
}

/** raw patent id → its keys at `level` (for colouring concepts, S4). */
function patentKeysByRawId(graph: GraphData, level: IpcLevel): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const node of graph.nodes) {
    if (node.type !== 'patent') continue
    map.set(node.id.replace(/^patent:/, ''), ipcKeysOfPatents(node.ipc5, level))
  }
  return map
}

/**
 * S4: dominant IPC of a concept = the key with the most covering patents
 * (each patent counts once per key). Tie → lexicographically smaller key.
 * `null` when no covering patent has a key at this level.
 */
export function dominantIpcOfConcept(
  graph: GraphData,
  node: GraphNode,
  level: IpcLevel,
): string | null {
  if (node.type !== 'concept') return null
  const patentKeys = patentKeysByRawId(graph, level)
  const tally = new Map<string, number>()
  for (const raw of node.source_patents ?? []) {
    const keys = patentKeys.get(raw)
    if (!keys) continue
    for (const key of keys) tally.set(key, (tally.get(key) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [key, count] of tally) {
    if (count > bestCount || (count === bestCount && best !== null && key < best)) {
      best = key
      bestCount = count
    }
  }
  return best
}

/**
 * S4: pure view-layer recolour — concept nodes take their dominant IPC colour;
 * concepts without any IPC-bearing patent keep their current colour. Never
 * mutates input nodes.
 */
export function applyIpcColour(
  graph: GraphData,
  nodes: GraphNode[],
  level: IpcLevel,
): GraphNode[] {
  const sortedKeys = ipcSortedKeys(graph, level)
  const colorByKey = new Map(sortedKeys.map((key) => [key, ipcColorOf(key, sortedKeys)]))
  return nodes.map((node) => {
    if (node.type !== 'concept') return node
    const dominant = dominantIpcOfConcept(graph, node, level)
    if (dominant === null) return node
    const color = colorByKey.get(dominant)
    return color ? { ...node, color } : node
  })
}

/** S5/legend: [{key, color, count}] sorted by count desc for the legend chips. */
export function ipcLegendItems(
  graph: GraphData,
  level: IpcLevel,
): Array<{ key: string; color: string; count: number }> {
  const sortedKeys = ipcSortedKeys(graph, level)
  const colorByKey = new Map(sortedKeys.map((key) => [key, ipcColorOf(key, sortedKeys)]))
  const countByKey = new Map<string, number>()
  for (const node of graph.nodes) {
    if (node.type !== 'patent') continue
    for (const key of ipcKeysOfPatents(node.ipc5, level)) {
      countByKey.set(key, (countByKey.get(key) ?? 0) + 1)
    }
  }
  return Array.from(countByKey.entries())
    .map(([key, count]) => ({ key, count, color: colorByKey.get(key) ?? '#94a3b8' }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'zh-Hant'))
}
