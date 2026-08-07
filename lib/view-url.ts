/**
 * PRD v2 / P3 (N6): view-state ⇄ URL serialisation.
 *
 * The analysis viewer mirrors its view state into the page URL with
 * `history.replaceState` so a shared link restores the exact view — including
 * the P3 gradient colour mode (`colorMode`). Both directions are kept pure
 * here so they are unit-testable (the repo's convention is pure-logic tests;
 * there is no component test harness in this project).
 */
import type { ColorMode } from './graph-view'
import type { GraphMode } from '../types/graph'

export interface ViewState {
  mode: GraphMode
  showSemantic: boolean
  paperMode: boolean
  colorMode: ColorMode
  minSupport: number
  yearRange: [number, number]
}

const isMode = (value: string | null): value is GraphMode =>
  value === 'concept' || value === 'context'

const isColorMode = (value: string | null): value is ColorMode =>
  value === 'community' || value === 'first_year'

/**
 * Parse a URL query (pass `window.location.search`, including a leading `?`).
 * Returns only the fields that are valid; absent / malformed values are left
 * undefined so callers fall back to their defaults.
 */
export function parseViewQuery(search: string): Partial<ViewState> {
  const p = new URLSearchParams(search)
  const out: Partial<ViewState> = {}

  const mode = p.get('mode')
  if (isMode(mode)) out.mode = mode

  const colorMode = p.get('colorMode')
  if (isColorMode(colorMode)) out.colorMode = colorMode

  const llm = p.get('llm')
  if (llm === '1') out.showSemantic = true
  else if (llm === '0') out.showSemantic = false

  const minSupport = Number(p.get('minSupport'))
  if (Number.isInteger(minSupport) && minSupport >= 1) out.minSupport = minSupport

  const paper = p.get('paper')
  if (paper === '1') out.paperMode = true
  else if (paper === '0') out.paperMode = false

  // Number(null) is 0, so guard on the raw value before coercing: an ABSENT
  // year parameter must not be read as year 0.
  const startRaw = p.get('yearStart')
  const endRaw = p.get('yearEnd')
  const start = startRaw === null ? NaN : Number(startRaw)
  const end = endRaw === null ? NaN : Number(endRaw)
  if (Number.isFinite(start) && Number.isFinite(end) && start <= end) {
    out.yearRange = [start, end]
  }

  return out
}

/** Serialise the full view state into a URLSearchParams query string. */
export function toViewQueryString(state: ViewState): string {
  return new URLSearchParams({
    mode: state.mode,
    llm: state.showSemantic ? '1' : '0',
    paper: state.paperMode ? '1' : '0',
    colorMode: state.colorMode,
    minSupport: String(state.minSupport),
    yearStart: String(state.yearRange[0]),
    yearEnd: String(state.yearRange[1]),
  }).toString()
}