import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Merge } from "lucide-react";
import { Button } from "@/components/ui/button";
import SynonymEditor from "@/components/SynonymEditor";
import { requireAdmin, UnauthorizedError } from "@/lib/db/sessions";

export default async function SynonymsPage() {
	await requireAdmin().catch((error: unknown) => {
		if (error instanceof UnauthorizedError) redirect("/login?next=/synonyms");
		redirect("/");
	});

	return (
		<main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
			<div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
				<header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-start gap-3">
						<span className="mt-0.5 rounded-lg border border-border bg-card p-2 text-primary">
							<Merge size={20} aria-hidden />
						</span>
						<div>
							<h1 className="font-serif text-2xl font-bold">同義詞治理</h1>
							<p className="mt-1 text-sm text-muted-foreground">
								把同一技術概念的不同寫法合併成一個節點（如「AI」與「人工智能」歸為「人工智慧」）。
							</p>
						</div>
					</div>
					<Button
						variant="outline"
						nativeButton={false}
						render={<Link href="/" />}
						className="w-fit"
					>
						<ArrowLeft size={16} aria-hidden />
						返回分析平台
					</Button>
				</header>

				<SynonymEditor />
			</div>
		</main>
	);
}
