import { notFound } from 'next/navigation'
import { loadGraphData } from '@/lib/store'
import GraphLayout from '@/components/GraphLayout'

interface Props {
  params: Promise<{ id: string }>
}

export default async function AnalysisPage({ params }: Props) {
  const { id } = await params
  const graph = loadGraphData(id)

  if (!graph) {
    notFound()
  }

  return <GraphLayout graph={graph} jobId={id} />
}
