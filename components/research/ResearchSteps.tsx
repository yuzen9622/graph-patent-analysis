export function ResearchSteps({ steps }: { steps: string[] }) {
  return <ol className="list-decimal space-y-1 pl-5">
    {steps.map((step, index) => <li key={index}>{step.replace(/^\s*\d+[.．、)）](?!\d)\s*/, "")}</li>)}
  </ol>;
}
