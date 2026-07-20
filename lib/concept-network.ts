import type {
  ExtractionResult,
  GraphEdge,
  RelationEvidence,
} from '../types/graph'

export interface ConceptAggregate {
  label: string
  frequency: number
  source_patents: string[]
}

export interface ConceptNetworkResult {
  concepts: Map<string, ConceptAggregate>
  cooccurrenceEdges: GraphEdge[]
  semanticEdges: GraphEdge[]
}

const sortText = (a: string, b: string) => a.localeCompare(b, 'zh-Hant')

function hashText(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function stableEdgeId(kind: string, tuple: readonly string[]): string {
  const canonical = JSON.stringify([kind, ...tuple])
  return `e:${kind}:${hashText(canonical)}`
}

export function applicantSize(patentCount: number): number {
  const count = Number.isFinite(patentCount) ? Math.max(0, patentCount) : 0
  return Math.min(52, Math.max(18, 18 + 5 * Math.sqrt(count)))
}

export function conceptSize(frequency: number): number {
  const count = Number.isFinite(frequency) ? Math.max(0, frequency) : 0
  return Math.min(52, Math.max(10, 10 + 6 * Math.sqrt(count)))
}

export const PATENT_NODE_SIZE = 18

function cleanedKeywords(extraction: ExtractionResult): string[] {
  return Array.from(
    new Set((extraction.keywords ?? []).map((keyword) => keyword.trim()).filter(Boolean)),
  ).sort(sortText)
}

export function buildConceptNetwork(
  extractions: ExtractionResult[],
): ConceptNetworkResult {
  const conceptPatents = new Map<string, Set<string>>()
  const pairPatents = new Map<string, { source: string; target: string; patents: Set<string> }>()
  const semantic = new Map<
    string,
    {
      source: string
      target: string
      relation: string
      evidence: RelationEvidence[]
      patents: Set<string>
    }
  >()

  for (const extraction of extractions) {
    const keywords = cleanedKeywords(extraction)
    const keywordSet = new Set(keywords)

    for (const keyword of keywords) {
      const patents = conceptPatents.get(keyword) ?? new Set<string>()
      patents.add(extraction.patent_id)
      conceptPatents.set(keyword, patents)
    }

    for (let i = 0; i < keywords.length; i += 1) {
      for (let j = i + 1; j < keywords.length; j += 1) {
        const source = keywords[i]
        const target = keywords[j]
        const key = JSON.stringify([source, target])
        const pair = pairPatents.get(key) ?? { source, target, patents: new Set<string>() }
        pair.patents.add(extraction.patent_id)
        pairPatents.set(key, pair)
      }
    }

    for (const rawRelation of extraction.relations ?? []) {
      const source = rawRelation.source.trim()
      const target = rawRelation.target.trim()
      const relation = rawRelation.relation.trim()
      if (!source || !target || !relation || source === target) continue
      if (!keywordSet.has(source) || !keywordSet.has(target)) continue

      const key = JSON.stringify([source, target, relation])
      const group = semantic.get(key) ?? {
        source,
        target,
        relation,
        evidence: [],
        patents: new Set<string>(),
      }
      group.evidence.push({
        patent_id: extraction.patent_id,
        weight: rawRelation.weight,
        reason: rawRelation.reason,
        confidence: rawRelation.confidence,
      })
      group.patents.add(extraction.patent_id)
      semantic.set(key, group)
    }
  }

  const concepts = new Map<string, ConceptAggregate>()
  for (const label of Array.from(conceptPatents.keys()).sort(sortText)) {
    const sourcePatents = Array.from(conceptPatents.get(label) ?? []).sort(sortText)
    concepts.set(label, {
      label,
      frequency: sourcePatents.length,
      source_patents: sourcePatents,
    })
  }

  const cooccurrenceEdges = Array.from(pairPatents.values())
    .sort((a, b) => sortText(a.source, b.source) || sortText(a.target, b.target))
    .map((pair): GraphEdge => {
      const sourcePatents = Array.from(pair.patents).sort(sortText)
      const frequencyA = concepts.get(pair.source)?.frequency ?? 0
      const frequencyB = concepts.get(pair.target)?.frequency ?? 0
      const union = frequencyA + frequencyB - sourcePatents.length
      return {
        id: stableEdgeId('cooccurrence', [pair.source, pair.target]),
        from: `concept:${pair.source}`,
        to: `concept:${pair.target}`,
        relation: '共同出現',
        kind: 'cooccurrence',
        support_count: sourcePatents.length,
        jaccard: union > 0 ? sourcePatents.length / union : 0,
        source_patents: sourcePatents,
        weight: sourcePatents.length,
      }
    })

  const semanticEdges = Array.from(semantic.values())
    .sort(
      (a, b) =>
        sortText(a.source, b.source) ||
        sortText(a.target, b.target) ||
        sortText(a.relation, b.relation),
    )
    .map((group): GraphEdge => {
      const sourcePatents = Array.from(group.patents).sort(sortText)
      const weights = group.evidence
        .map((item) => item.weight)
        .filter((weight): weight is number => Number.isFinite(weight))
      return {
        id: stableEdgeId('semantic', [group.source, group.target, group.relation]),
        from: `concept:${group.source}`,
        to: `concept:${group.target}`,
        relation: group.relation,
        kind: 'semantic',
        support_count: sourcePatents.length,
        source_patents: sourcePatents,
        source_patent: sourcePatents[0],
        evidence: group.evidence,
        weight:
          weights.length > 0
            ? weights.reduce((sum, weight) => sum + weight, 0) / weights.length
            : undefined,
        reason: group.evidence[0]?.reason,
        confidence: group.evidence[0]?.confidence,
      }
    })

  return { concepts, cooccurrenceEdges, semanticEdges }
}
