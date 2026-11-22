import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import AdminUserManagement from "@/components/AdminUserManagement";
import { requireAdmin, UnauthorizedError } from "@/lib/db/sessions";

export default async function AdminUsersPage() {
	const user = await requireAdmin().catch((error: unknown) => {
		if (error instanceof UnauthorizedError)
			redirect("/login?next=/admin/users");
		redirect("/");
	});

	return (
		<main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
			<div className="mx-auto grid w-full max-w-6xl items-start gap-8 xl:grid-cols-[14rem_minmax(0,1fr)]">
				<header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between xl:flex-col xl:items-start">
					<div className="flex items-start gap-3">

						<div>
							<h1 className="text-2xl font-semibold">帳號管理</h1>
							<p className="mt-1 text-sm text-muted-foreground">
								新增、修改或刪除研究平台帳號。
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

				<AdminUserManagement currentUserId={user.id} />
			</div>
		</main>
	);
}
