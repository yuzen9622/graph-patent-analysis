import { describe, expect, it } from 'vitest'
import {
  buildSynonymMap,
  createSnapshot,
  resolveKeyword,
  type SynonymGroup,
} from '../lib/synonyms'

function group(partial: Partial<SynonymGroup> & { canonical: string }): SynonymGroup {
  return { id: partial.id ?? `g:${partial.canonical}`, aliases: [], ...partial }
}

describe('buildSynonymMap', () => {
  it('把 alias 對應到 canonical，canonical 對應到自己', () => {
    const { map, warnings } = buildSynonymMap([
      group({ canonical: '人工智慧', aliases: ['AI', '人工智能'] }),
      group({ canonical: '區塊鏈', aliases: ['Blockchain'] }),
    ])
    expect(warnings).toEqual([])
    expect(map.get('AI')).toBe('人工智慧')
    expect(map.get('人工智能')).toBe('人工智慧')
    expect(map.get('人工智慧')).toBe('人工智慧')
    expect(map.get('Blockchain')).toBe('區塊鏈')
    // 無關詞不誤傷
    expect(map.get('雲端運算')).toBeUndefined()
  })

  it('alias 前後空白會先剝掉再對應（查詢端用 resolveKeyword）', () => {
    const { map } = buildSynonymMap([
      group({ canonical: '區塊鏈', aliases: ['  Blockchain '] }),
    ])
    expect(resolveKeyword(' Blockchain ', map)).toBe('區塊鏈')
    expect(resolveKeyword('Blockchain', map)).toBe('區塊鏈')
  })

  it('決定性：與輸入順序無關', () => {
    const a = [
      group({ canonical: '支付', aliases: ['付款'] }),
      group({ canonical: '風控', aliases: ['風險控管'] }),
    ]
    const b = [
      group({ canonical: '風控', aliases: ['風險控管'] }),
      group({ canonical: '支付', aliases: ['付款'] }),
    ]
    expect(buildSynonymMap(a)).toEqual(buildSynonymMap(b))
  })

  it('偵測衝突：同一 alias 出現在兩個群組（先到者勝，記 warning）', () => {
    const { map, warnings } = buildSynonymMap([
      group({ canonical: '人工智慧', aliases: ['AI'] }),
      group({ canonical: 'AI（行動裝置）', aliases: ['AI'] }),
    ])
    expect(map.get('AI')).toBe('人工智慧')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('AI')
  })

  it('偵測衝突：alias 恰好是另一群組的 canonical（歧義）', () => {
    const { map, warnings } = buildSynonymMap([
      group({ canonical: '行動支付', aliases: ['QRcode支付'] }),
      group({ canonical: 'QRcode支付', aliases: ['掃碼支付'] }),
    ])
    // canonical 第一次先到；之後 alias「QRcode支付」欲指向「掃碼支付」被擋
    expect(map.get('QRcode支付')).toBe('行動支付')
    expect(map.get('掃碼支付')).toBeUndefined()
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('canonical 重複定義只保留第一個', () => {
    const { map, warnings } = buildSynonymMap([
      group({ canonical: '支付', aliases: ['付款'] }),
      group({ canonical: '支付', aliases: ['結帳'] }),
    ])
    expect(map.get('付款')).toBe('支付')
    expect(map.get('結帳')).toBeUndefined()
    expect(warnings.some((w) => w.includes('重複定義'))).toBe(true)
  })
})

describe('resolveKeyword', () => {
  it('無對應群組時原樣回傳（trim + 內部空白收斂）', () => {
    expect(resolveKeyword(' 雲端 ', new Map())).toBe('雲端')
  })
  it('有對應群組時回傳 canonical', () => {
    const { map } = buildSynonymMap([group({ canonical: '反洗錢', aliases: ['AML'] })])
    expect(resolveKeyword('AML', map)).toBe('反洗錢')
  })
})

describe('createSnapshot', () => {
  it('深拷貝：日後編輯原詞典不會污染快照', () => {
    const groups = [group({ canonical: '人工智慧', aliases: ['AI'] })]
    const snapshot = createSnapshot(groups)
    groups[0]!.aliases.push('人工智能') // 事後編輯
    expect(snapshot.groups[0]!.aliases).toEqual(['AI'])
    expect(snapshot.captured_at).toBeTruthy()
  })
})
