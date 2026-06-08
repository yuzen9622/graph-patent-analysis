import { notFound, redirect } from 'next/navigation'
import { loadGraphData, getJob } from '@/lib/store'
import GraphLayout from '@/components/GraphLayout'

interface Props {
  params: Promise<{ id: string }>
}

export default async function AnalysisPage({ params }: Props) {
  const { id } = await params
  const graph = loadGraphData(id)

  if (!graph) {
    const job = getJob(id)
    if (job && job.status === 'running') {
      redirect(`/?jobId=${id}`)
    }
    notFound()
  }

  return <GraphLayout graph={graph} jobId={id} />
}
