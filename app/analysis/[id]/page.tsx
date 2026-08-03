import { notFound, redirect } from 'next/navigation'
import { getJob } from '@/lib/store'
import { loadGraph } from '@/lib/db/analyses'
import { currentUser } from '@/lib/db/sessions'
import GraphLayout from '@/components/GraphLayout'

interface Props {
  params: Promise<{ id: string }>
}

export default async function AnalysisPage({ params }: Props) {
  const { id } = await params

  // proxy.ts already rejected unsigned cookies; this is the authoritative check.
  const user = await currentUser()
  if (!user) redirect(`/login?next=/analysis/${id}`)

  const graph = await loadGraph(id)

  if (!graph) {
    const job = getJob(id)
    if (job && job.status === 'running') {
      redirect(`/?jobId=${id}`)
    }
    notFound()
  }

  return <GraphLayout graph={graph} jobId={id} />
}
