// lib/synonyms.ts — PRD v2 / P1 同義詞治理
//
// 概念目前是完全字面比對去重（「人工智慧」與「AI」分裂成兩個節點）。
// P1 提供人工可編輯、跨分析共用、但帶不可變版本快照的同義詞詞典：
//
//   - 詞典是「同義詞群組」的集合：一個群組 = 一個 canonical 代表 + 若干 aliases。
//     任一 alias（或 canonical 本身）在輸入層被 normalize 成 canonical。
//   - 合併必須發生在共現計算的輸入層（decision #6）：若事後合併，
//     (AI, X) 與 (人工智慧, X) 會產生同一個 edge id 而 addEdge 丟掉後者，
//     support_count 只留先到者而非聯集。所以在 buildConceptNetwork() 內、
//     建立任何 pair / concept map 之前就先 normalize。
//   - 詞典全域共用（synonym_groups 表）；分析執行當下把當次詞典快照存到
//     analyses.synonym_snapshot（不可變），舊分析重開不會因詞典日後變動而變樣。

export interface SynonymGroup {
  /** 穩定 id（uuid）。 */
  id: string
  /** 代表標籤：所有 aliases（與它自己）在輸入層都會被 normalize 成它。 */
  canonical: string
  /** 同義詞清單；不含 canonical 本身。 */
  aliases: string[]
  /** 人工備註（可選）。 */
  note?: string
}

/** 分析執行當下的詞典快照（不可變，隨分析落庫）。 */
export interface SynonymSnapshot {
  groups: SynonymGroup[]
  captured_at: string // ISO 8601 UTC
}

export interface SynonymMapResult {
  /** alias / canonical → canonical。輸入層 normalize 用。 */
  map: Map<string, string>
  /**
   * 偵測到的衝突（不阻斷，但應記錄/顯示）：
   *   - 同一個 alias 出現在多個群組
   *   - 某群組的 alias 恰好是另一群組的 canonical（鏈式/歧義）
   */
  warnings: string[]
}

function normalizeToken(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/**
 * 由群組清單建立 normalize 用的 map。決定性（與輸入順序無關）：
 * 群組依 canonical 排序後依序填入；衝突時第一個群組勝出，其餘記入 warnings。
 */
export function buildSynonymMap(groups: readonly SynonymGroup[]): SynonymMapResult {
  const map = new Map<string, string>()
  const warnings: string[] = []
  const sorted = [...groups]
    .map((group) => ({ ...group, canonical: normalizeToken(group.canonical) }))
    .filter((group) => group.canonical.length > 0)
    .sort((a, b) => a.canonical.localeCompare(b.canonical, 'zh-Hant'))

  for (const group of sorted) {
    if (map.has(group.canonical)) {
      warnings.push(`canonical「${group.canonical}」重複定義，保留第一個群組`)
      continue
    }
    map.set(group.canonical, group.canonical)
    for (const rawAlias of group.aliases) {
      const alias = normalizeToken(rawAlias)
      if (!alias || alias === group.canonical) continue
      if (map.has(alias)) {
        const existing = map.get(alias)
        warnings.push(
          `「${alias}」同時被定義為「${existing}」與「${group.canonical}」的同義詞，保留先到者`,
        )
        continue
      }
      map.set(alias, group.canonical)
    }
  }

  return { map, warnings }
}

/** 單一關鍵字 normalize：無對應群組時原樣回傳。 */
export function resolveKeyword(keyword: string, map: ReadonlyMap<string, string>): string {
  const normalized = normalizeToken(keyword)
  return map.get(normalized) ?? normalized
}

/** 分析啟動時建立快照（拷貝群組內容，避免日後編輯污染舊分析）。 */
export function createSnapshot(groups: readonly SynonymGroup[]): SynonymSnapshot {
  return {
    groups: groups.map((group) => ({
      id: group.id,
      canonical: group.canonical,
      aliases: [...group.aliases],
      ...(group.note !== undefined ? { note: group.note } : {}),
    })),
    captured_at: new Date().toISOString(),
  }
}

/** 快照 → map（重載時若需重算/重現時用）。 */
export function snapshotToMap(snapshot: SynonymSnapshot): SynonymMapResult {
  return buildSynonymMap(snapshot.groups)
}
