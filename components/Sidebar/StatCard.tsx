interface StatCardProps {
	label: string;
	value: string;
	/** 次要說明（例如「篇」「家」單位或註記）。 */
	sub?: string;
}

/** 資料密集型指標卡：等寬數字、小標籤，供節點／關係資訊區使用。 */
export default function StatCard({ label, value, sub }: StatCardProps) {
	return (
		<div className="min-w-0 rounded-md border border-border bg-background px-2.5 py-2">
			<div className="truncate font-mono text-sm font-semibold text-foreground tabular-nums leading-none">
				{value}
			</div>
			<div className="mt-1 truncate text-[0.7rem] text-muted-foreground">
				{label}
				{sub ? <span className="text-muted-foreground/70"> · {sub}</span> : null}
			</div>
		</div>
	);
}
