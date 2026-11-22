"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { LogOut, Settings, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface SessionUser {
  display_name?: string | null;
	username: string;
	role: "admin" | "researcher";
}

/**
 * Shows the signed-in account and a logout action. The session cookie is
 * httpOnly, so the username comes from /api/auth/me (populated by proxy.ts).
 */
const WorkspaceUser = createContext<SessionUser | null>(null);
export const useWorkspaceUser = () => useContext(WorkspaceUser);

export function WorkspaceUserProvider({ children }: { children: ReactNode }) {
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
					setUser({ username: body.username, display_name: body.display_name, role: body.role });
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

  return <WorkspaceUser.Provider value={user}>{children}</WorkspaceUser.Provider>;
}

export default function UserMenu({ compact = false }: { compact?: boolean }) {
  const user = useWorkspaceUser();
  if (!user) return null;

	async function handleLogout() {
		await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
		window.location.assign("/login");
	}

  const name = user.display_name || user.username;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size={compact ? "icon" : "lg"} className={compact ? "" : "min-w-0 flex-1 justify-start"} aria-label={`使用者選單：${name}`} />}>
        <Avatar size="sm"><AvatarFallback>{Array.from(name)[0]}</AvatarFallback></Avatar>
        {!compact && <><span className="truncate">{name}</span><ChevronsUpDown className="ml-auto" aria-hidden /></>}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        {user.role === "admin" && <>
          <DropdownMenuItem render={<Link href="/admin/users" />}><Settings />帳號管理</DropdownMenuItem>
        </>}
        <DropdownMenuItem onClick={handleLogout}><LogOut />登出</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
