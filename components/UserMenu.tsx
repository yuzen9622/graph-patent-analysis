"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogOut, Settings, User } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SessionUser {
	username: string;
	role: "admin" | "researcher";
}

/**
 * Shows the signed-in account and a logout action. The session cookie is
 * httpOnly, so the username comes from /api/auth/me (populated by proxy.ts).
 */
export default function UserMenu() {
	const [user, setUser] = useState<SessionUser | null>(null);

	useEffect(() => {
		let cancelled = false;
		fetch("/api/auth/me")
			.then((res) => (res.ok ? res.json() : null))
			.then((body: Partial<SessionUser> | null) => {
				if (
					!cancelled &&
					body?.username &&
					(body.role === "admin" || body.role === "researcher")
				) {
					setUser({ username: body.username, role: body.role });
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	if (!user) return null;

	async function handleLogout() {
		await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
		window.location.assign("/login");
	}

	return (
		<div className="ml-auto flex items-center gap-2 sm:gap-3">
			<span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
				<User size={12} aria-hidden />
				{user.username}
			</span>
			{user.role === "admin" && (
				<Button
					variant="outline"
					size="xs"
					nativeButton={false}
					render={<Link href="/admin/users" />}
					className="h-auto gap-1.5 rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
				>
					<Settings size={12} aria-hidden />
					帳號管理
				</Button>
			)}
			<Button
				type="button"
				variant="outline"
				size="xs"
				onClick={handleLogout}
				className="h-auto gap-1.5 rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
			>
				<LogOut size={12} aria-hidden />
				登出
			</Button>
		</div>
	);
}
