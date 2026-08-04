import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import AdminUserManagement from "@/components/AdminUserManagement";
import { requireAdmin, UnauthorizedError } from "@/lib/db/sessions";

export default async function AdminUsersPage() {
  const user = await requireAdmin().catch((error: unknown) => {
    if (error instanceof UnauthorizedError) redirect("/login?next=/admin/users");
    redirect("/");
  });

  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 rounded-lg border border-border bg-card p-2 text-success">
              <ShieldCheck size={20} aria-hidden />
            </span>
            <div>
              <h1 className="font-serif text-2xl font-bold">帳號管理</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                新增、修改或刪除研究平台帳號。
              </p>
            </div>
          </div>
          <Link
            href="/"
            className="inline-flex h-8 w-fit items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ArrowLeft size={16} aria-hidden />
            返回分析平台
          </Link>
        </header>

        <AdminUserManagement currentUserId={user.id} />
      </div>
    </main>
  );
}
